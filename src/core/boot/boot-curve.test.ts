import { describe, expect, it } from 'vitest'

import { BOOT_SEGMENTS, bootCurve, clamp01, easeInCubic, easeOutCubic } from './boot-curve'

describe('bootCurve（开机分段变速曲线）', () => {
  it('starts at 0 and lands exactly on 1', () => {
    expect(bootCurve(0)).toBe(0)
    expect(bootCurve(1)).toBeCloseTo(1, 12)
  })

  it('is strictly monotonically non-decreasing across the whole timeline', () => {
    let prev = bootCurve(0)
    for (let i = 1; i <= 400; i++) {
      const p = bootCurve(i / 400)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
  })

  it('never runs linear: first segment midpoint outruns linear interpolation', () => {
    // 第一段中点 t=0.08：easeOutCubic(0.5)=0.875 → p≈0.315，远超线性 0.18。
    expect(bootCurve(0.08)).toBeGreaterThan(0.3)
  })

  it('clamps out-of-range time', () => {
    expect(bootCurve(-0.5)).toBe(0)
    expect(bootCurve(1.5)).toBeCloseTo(1, 12)
  })

  it('matches the four-segment rhythm of motion-lab (36/62/80/100)', () => {
    const shares = BOOT_SEGMENTS.map((seg) => seg.share)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12)
    expect(BOOT_SEGMENTS.map((seg) => seg.to)).toEqual([0.36, 0.62, 0.8, 1])
    // 段边界进度：第一段结束恰为 0.36（share 合计 1 时 t=0.16 落在边界上）。
    expect(bootCurve(0.16)).toBeCloseTo(0.36, 12)
  })

  it('supports custom segments for reuse', () => {
    const segments = [{ to: 1, share: 1, ease: easeOutCubic, note: '单段' }]
    expect(bootCurve(0.5, segments)).toBeCloseTo(easeOutCubic(0.5), 12)
    expect(bootCurve(1, segments)).toBe(1)
  })

  it('degrades the last segment into a catch-all when shares under-fill', () => {
    const segments = [
      { to: 0.5, share: 0.5, ease: easeOutCubic, note: '半程' },
      { to: 0.9, share: 0.4, ease: easeInCubic, note: '缺口兜底' },
    ]
    // share 合计 0.9 < 1：末段兜底吞掉剩余时间，t=1 仍收敛到末段 to（0.9）。
    expect(bootCurve(1, segments)).toBeCloseTo(0.9, 12)
  })
})

describe('clamp01 / ease helpers', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.42)).toBe(0.42)
    expect(clamp01(2)).toBe(1)
  })

  it('keeps the ease functions within range', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      expect(easeOutCubic(t)).toBeGreaterThanOrEqual(0)
      expect(easeOutCubic(t)).toBeLessThanOrEqual(1)
      expect(easeInCubic(t)).toBeGreaterThanOrEqual(0)
      expect(easeInCubic(t)).toBeLessThanOrEqual(1)
    }
  })
})

describe('bootCurve 数值边界（B1 审查）', () => {
  it('NaN 输入回 0；x 落在 share=0 段上是段末（不再 NaN）；过冲缓动被钳回 0~1', () => {
    expect(bootCurve(Number.NaN)).toBe(0)
    const zeroShare = [
      { to: 0.5, share: 0, ease: (t: number): number => t, note: 'zero' },
      { to: 1, share: 1, ease: (t: number): number => t, note: 'rest' },
    ]
    // 旧实现 local=(0-0)/0=NaN 一路 NaN；现直接落到段末。
    expect(bootCurve(0, zeroShare)).toBe(0.5)
    // 跨过零占比段后按剩余段插值（单调不减）。
    expect(bootCurve(0.4, zeroShare)).toBe(0.7)
    const overshoot = [
      { to: 1, share: 1, ease: (t: number): number => t * 3, note: 'overshoot' },
    ]
    expect(bootCurve(0.5, overshoot)).toBe(1)
  })
})
