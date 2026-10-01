import { describe, expect, it } from 'vitest'

import {
  AURORA_PARAMS,
  blobPose,
  buildBlobLayout,
  createAuroraRandom,
  hexToRgba,
} from './aurora-engine'
import { TILT_PARAMS, tiltAngles } from './use-focus-tilt'

describe('aurora-engine (§32.5 修订 10，motion-lab aurora 归档)', () => {
  it('builds a deterministic blob layout from the fixed-seed LCG', () => {
    const a = buildBlobLayout(AURORA_PARAMS.blobCount, createAuroraRandom())
    const b = buildBlobLayout(AURORA_PARAMS.blobCount, createAuroraRandom())
    expect(a).toEqual(b) // 刷新一致：同种子同布局（回归锚点）
    expect(a).toHaveLength(4)
    for (const blob of a) {
      expect(blob.bx).toBeGreaterThanOrEqual(0.12)
      expect(blob.bx).toBeLessThanOrEqual(0.88)
      expect(blob.r).toBeGreaterThanOrEqual(AURORA_PARAMS.radiusMin)
      expect(blob.r).toBeLessThanOrEqual(AURORA_PARAMS.radiusMax)
    }
  })

  it('orbits each blob around its base point without exceeding the orbit radius', () => {
    const blob = buildBlobLayout(1, createAuroraRandom())[0]
    for (const t of [0, 3.3, 17, 97]) {
      const pose = blobPose(blob, t, 1000, 800)
      // 位置 = 基准 ± 轨道（像素坐标），呼吸半径围绕基准半径。
      expect(pose.x).toBeGreaterThanOrEqual((blob.bx - blob.orbit) * 1000 - 1)
      expect(pose.x).toBeLessThanOrEqual((blob.bx + blob.orbit) * 1000 + 1)
      const m = Math.min(1000, 800)
      expect(pose.r).toBeGreaterThanOrEqual(blob.r * m * 0.91)
      expect(pose.r).toBeLessThanOrEqual(blob.r * m * 1.09)
    }
  })

  it('converts hex sprite colors to rgba strings', () => {
    expect(hexToRgba('#2f5fe8', 0.85)).toBe('rgba(47,95,232,0.85)')
    expect(hexToRgba('#ffffff', 0)).toBe('rgba(255,255,255,0)')
  })
})

describe('focus-tilt direction math (§32.5 修订 10，window-tilt 归档)', () => {
  it('tilts the focused window toward where the previous focus was', () => {
    // 新窗口在旧窗口右方 → rotateY 负角（朝来向让位）；下方 → rotateX 正角。
    // 纯水平切换：dy=0 走归档的 Math.sign(dy || 1) 兜底（+x 微仰），与实验室一致。
    expect(tiltAngles({ x: 200, y: 300 }, { x: 800, y: 300 })).toEqual({
      rx: TILT_PARAMS.tiltDegX,
      ry: -TILT_PARAMS.tiltDegY,
    })
    expect(tiltAngles({ x: 800, y: 300 }, { x: 200, y: 300 })).toEqual({
      rx: TILT_PARAMS.tiltDegX,
      ry: TILT_PARAMS.tiltDegY,
    })
    // 纯垂直切换：dx=0 同样走 || 1 兜底（ry 取 -tiltDegY）。
    expect(tiltAngles({ x: 500, y: 100 }, { x: 500, y: 600 })).toEqual({
      rx: TILT_PARAMS.tiltDegX,
      ry: -TILT_PARAMS.tiltDegY,
    })
  })

  it('keeps every tilt within the ≤2deg iron rule and degrades without a previous focus', () => {
    expect(tiltAngles(null, { x: 1, y: 1 })).toEqual({ rx: 0, ry: 0 })
    const wide = tiltAngles({ x: -5000, y: -5000 }, { x: 5000, y: 5000 })
    expect(Math.abs(wide.rx)).toBeLessThanOrEqual(2)
    expect(Math.abs(wide.ry)).toBeLessThanOrEqual(2)
  })
})
