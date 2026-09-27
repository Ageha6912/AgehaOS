import { describe, expect, it } from 'vitest'

import {
  WAVE_EASE,
  WAVE_ENTER_MS,
  WAVE_FALLOFF_RADIUS,
  WAVE_LIFT_HEIGHT,
  WAVE_MAX_SCALE,
  WAVE_SETTLE_MS,
  cubicBezierAt,
  gaussianScale,
  iconLift,
  iconScale,
  wavePose,
} from './wave'

describe('任务栏波浪常量（DESIGN.md §13 归档口径）', () => {
  it('archives to the product duration tiers', () => {
    expect(WAVE_ENTER_MS).toBe(120) // = --ag-motion-fast 同值
    expect(WAVE_SETTLE_MS).toBe(200) // = --ag-motion-base 同值（SPEC 200ms 级）
  })

  it('keeps the falloff within 1.2× the 48px icon pitch', () => {
    expect(WAVE_FALLOFF_RADIUS).toBeLessThanOrEqual(57.6)
    expect(WAVE_FALLOFF_RADIUS).toBeGreaterThan(0)
  })

  it('keeps the peak inside the 48px taskbar clip box', () => {
    // 20px 图标放大 1.5 → 30px + 上浮 3px：(48-30)/2 = 9px 余量 > 3px
    expect(WAVE_MAX_SCALE).toBe(1.5)
    expect(WAVE_LIFT_HEIGHT).toBe(3)
  })
})

describe('cubicBezierAt（CSS cubic-bezier 同语义求值）', () => {
  it('hits the endpoints exactly', () => {
    expect(cubicBezierAt(WAVE_EASE, 0)).toBe(0)
    expect(cubicBezierAt(WAVE_EASE, 1)).toBe(1)
    expect(cubicBezierAt(WAVE_EASE, -0.5)).toBe(0)
    expect(cubicBezierAt(WAVE_EASE, 1.5)).toBe(1)
  })

  it('is monotonic with a fast decelerating start for the standard ease curve', () => {
    let prev = 0
    for (let i = 1; i <= 20; i++) {
      const y = cubicBezierAt(WAVE_EASE, i / 20)
      expect(y).toBeGreaterThan(prev)
      prev = y
    }
    // [0.2, 0, 0, 1] = 强减速进场：前 1/4 时间走完大部分行程
    expect(cubicBezierAt(WAVE_EASE, 0.25)).toBeGreaterThan(0.25)
    expect(cubicBezierAt(WAVE_EASE, 0.75)).toBeGreaterThan(0.75)
    expect(cubicBezierAt(WAVE_EASE, 0.75)).toBeLessThan(1)
  })
})

describe('gaussianScale（距离衰减波形）', () => {
  it('peaks at maxScale under the pointer and relaxes to 1 far away', () => {
    expect(gaussianScale(0, 44, 1.5)).toBeCloseTo(1.5, 12)
    expect(gaussianScale(4000, 44, 1.5)).toBeCloseTo(1, 12)
  })

  it('equals 1 + (max-1)·e^(-1/2) at one sigma', () => {
    expect(gaussianScale(44, 44, 1.5)).toBeCloseTo(1 + 0.5 * Math.exp(-0.5), 12)
  })

  it('guards against a zero sigma', () => {
    expect(gaussianScale(0, 0, 1.5)).toBeCloseTo(1.5, 12)
  })

  it('degrades continuously (no jumps between adjacent samples)', () => {
    let prev = gaussianScale(0, 44, 1.5)
    for (let d = 1; d <= 200; d++) {
      const s = gaussianScale(d, 44, 1.5)
      expect(s).toBeLessThanOrEqual(prev)
      expect(s).toBeGreaterThanOrEqual(1)
      prev = s
    }
  })
})

describe('iconScale（波形 × 进入包络）', () => {
  it('is identity at zero influence and the full wave at one', () => {
    expect(iconScale(10, 0)).toBe(1)
    expect(iconScale(10, 1)).toBe(gaussianScale(10, WAVE_FALLOFF_RADIUS, WAVE_MAX_SCALE))
  })

  it('interpolates linearly with influence and clamps out-of-range values', () => {
    const full = iconScale(10, 1)
    expect(iconScale(10, 0.5)).toBeCloseTo(1 + (full - 1) / 2, 12)
    expect(iconScale(10, 2)).toBe(full) // 上越界钳制
    expect(iconScale(10, -1)).toBe(1) // 下越界钳制
  })
})

describe('iconLift / wavePose（位姿合成）', () => {
  it('lifts proportionally to the magnification ratio', () => {
    expect(iconLift(1)).toBe(0)
    expect(iconLift(WAVE_MAX_SCALE)).toBeCloseTo(WAVE_LIFT_HEIGHT, 12)
    expect(iconLift(1.25)).toBeCloseTo(WAVE_LIFT_HEIGHT / 2, 12)
  })

  it('composes translateY before scale and formats deterministically', () => {
    expect(wavePose(1.5, 3)).toBe('translateY(-3.00px) scale(1.5000)')
    expect(wavePose(1, 0)).toBe('translateY(0.00px) scale(1.0000)') // (-0).toFixed 无负号
  })
})
