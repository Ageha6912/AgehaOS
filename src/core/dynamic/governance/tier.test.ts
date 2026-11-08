import { describe, expect, it } from 'vitest'

import {
  BOOT_PROBE_FPS_THRESHOLD,
  detectTier,
  evaluateDegrade,
  TIER_TARGET_FPS,
} from './tier'

describe('tier detection (§7.1，验收 ⑤)', () => {
  it('classifies high-end devices', () => {
    expect(detectTier({ deviceMemory: 8, hardwareConcurrency: 8, hasWebGL2: true })).toBe('high')
    expect(detectTier({ deviceMemory: 16, hardwareConcurrency: 16, hasWebGL2: true })).toBe('high')
  })

  it('classifies mid-range devices', () => {
    expect(detectTier({ deviceMemory: 8, hardwareConcurrency: 4, hasWebGL2: true })).toBe('mid')
    expect(detectTier({ deviceMemory: 8, hardwareConcurrency: 8, hasWebGL2: false })).toBe('mid')
  })

  it('forces the low tier on constrained hardware', () => {
    expect(detectTier({ deviceMemory: 4, hardwareConcurrency: 8, hasWebGL2: true })).toBe('low')
    expect(detectTier({ deviceMemory: 8, hardwareConcurrency: 2, hasWebGL2: true })).toBe('low')
    expect(detectTier({ deviceMemory: 4, hardwareConcurrency: 2, hasWebGL2: false })).toBe('low')
  })

  it('downgrades one tier when the boot probe is under 45fps (§7.3-5)', () => {
    expect(BOOT_PROBE_FPS_THRESHOLD).toBe(45)
    expect(
      detectTier({ deviceMemory: 8, hardwareConcurrency: 8, hasWebGL2: true, measuredFps: 44 }),
    ).toBe('mid')
    expect(
      detectTier({ deviceMemory: 8, hardwareConcurrency: 4, hasWebGL2: true, measuredFps: 44 }),
    ).toBe('low')
    expect(
      detectTier({ deviceMemory: 8, hardwareConcurrency: 8, hasWebGL2: true, measuredFps: 45 }),
    ).toBe('high')
  })
})

describe('runtime degrade ladder (§7.3 按档相对阈值)', () => {
  it('targets 60/30/0 fps per tier', () => {
    expect(TIER_TARGET_FPS.high).toBe(60)
    expect(TIER_TARGET_FPS.mid).toBe(30)
    expect(TIER_TARGET_FPS.low).toBe(0)
  })

  it('keeps animating when fps meets the tier target', () => {
    // 中档目标 30fps：33ms 帧间隔 → ~30fps ≥ 75%
    const frames: number[] = []
    for (let t = 0; t <= 3000; t += 33) frames.push(t)
    expect(evaluateDegrade('mid', frames, 3000).action).toBe('none')
  })

  it('pauses animation when the 2s average falls below 75% of the target', () => {
    // 中档：20fps（<22.5）持续 3s；5s 窗口内均值未跌破 50%（15fps）
    const frames: number[] = []
    for (let t = 0; t <= 3000; t += 50) frames.push(t)
    const decision = evaluateDegrade('mid', frames, 3000)
    expect(decision.action).toBe('pause-animation')
    expect(decision.measuredFps).toBeCloseTo(20, 0)
  })

  it('switches to static when the 5s average falls below 50% of the target', () => {
    // 中档：12.5fps（<15）持续 6s
    const frames: number[] = []
    for (let t = 0; t <= 6000; t += 80) frames.push(t)
    expect(evaluateDegrade('mid', frames, 6000).action).toBe('switch-static')
  })

  it('never animates on the low tier', () => {
    expect(evaluateDegrade('low', [0, 16, 32], 1000).action).toBe('none')
  })

  it('needs at least two frames to judge', () => {
    expect(evaluateDegrade('high', [100], 1000).action).toBe('none')
  })
})

describe('帧间洞不计入 FPS 跨度（B3 审查）', () => {
  it('页面隐藏 1.6s 后恢复旧帧率：不再被判成 switch-static 永久停动画', () => {
    // 30fps 稳态帧 + 中间 1600ms 空洞（切页/隐藏）+ 恢复后继续 33ms 帧。
    const frames = [1000, 1033, 1066, 2666, 2699, 2732, 2765]
    // 窗口 5000ms 覆盖全部：活跃跨度 = 66 + 33×3 = 165ms，6 帧间隔 → ~36fps
    // ≈ mid 目标 30 的 0.75 档以上（不再因 1.6s 洞打到 2.5fps 静态档）。
    const decision = evaluateDegrade('mid', frames, 2765)
    expect(decision.action).not.toBe('switch-static')
    expect(decision.measuredFps).toBeGreaterThan(30)
  })
})
