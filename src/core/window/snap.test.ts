import { describe, expect, it } from 'vitest'

import { calculateSnapGeometry, snapEdgeWidth, snapIntentFromPointer } from './snap'

/**
 * W4 snap 纯几何测试（审计 .tmp/spaces-audit.md §7）：几何左右对称、band
 * 边界、判定带宽度随视口缩放（320px 与 2560px 两组断言，杜绝 1920 硬编码）。
 */

describe('calculateSnapGeometry（W4 审计 §7）', () => {
  const band = { left: 80, top: 32, width: 1000, height: 768 }

  it('左半屏：x/y 落 band 原点，宽=半带宽、高=带高（band 底=屏幕底）', () => {
    expect(calculateSnapGeometry('left', band)).toEqual({
      x: 80,
      y: 32,
      width: 500,
      height: 768,
    })
  })

  it('右半屏：与左半对称，右缘贴齐 band 右缘', () => {
    expect(calculateSnapGeometry('right', band)).toEqual({
      x: 580,
      y: 32,
      width: 500,
      height: 768,
    })
    const right = calculateSnapGeometry('right', band)
    expect(right.x + right.width).toBe(band.left + band.width)
  })

  it('奇数带宽：两半等宽且右半仍贴齐右缘', () => {
    const odd = { left: 0, top: 0, width: 1001, height: 600 }
    const left = calculateSnapGeometry('left', odd)
    const right = calculateSnapGeometry('right', odd)
    expect(left.width).toBe(500.5)
    expect(right.width).toBe(500.5)
    expect(right.x + right.width).toBe(1001)
  })

  it('band 原点非零时坐标随带平移（工作区带坐标，禁回全屏原点）', () => {
    const shifted = { left: 120, top: 48, width: 800, height: 640 }
    expect(calculateSnapGeometry('left', shifted).x).toBe(120)
    expect(calculateSnapGeometry('left', shifted).y).toBe(48)
  })
})

describe('snapEdgeWidth（缘判定带宽，审计 §7 钉死公式）', () => {
  it('320px 视口：带宽回落 12px 下限（Math.max 保底）', () => {
    expect(snapEdgeWidth({ left: 0, top: 0, width: 320, height: 600 })).toBe(12)
  })

  it('2560px 视口：带宽随视口放大（round(2560*0.02)=51），证明无 1920 硬编码', () => {
    expect(snapEdgeWidth({ left: 0, top: 0, width: 2560, height: 1400 })).toBe(51)
  })

  it('1920px 视口：带宽 38（若硬编码 12/1920 专项值则此断言红）', () => {
    expect(snapEdgeWidth({ left: 0, top: 0, width: 1920, height: 1040 })).toBe(38)
  })
})

describe('snapIntentFromPointer（pointer→意图纯判定）', () => {
  const band = { left: 80, top: 32, width: 1000, height: 768 }
  // edge = max(12, round(1000*0.02)) = 20

  it('左缘判定带命中 → left（x ≤ band.left + edge）', () => {
    expect(snapIntentFromPointer(80, 400, band)).toEqual({ kind: 'left' })
    expect(snapIntentFromPointer(100, 400, band)).toEqual({ kind: 'left' })
    expect(snapIntentFromPointer(101, 400, band)).toBeNull()
  })

  it('右缘判定带命中 → right（x ≥ band.left + band.width - edge）', () => {
    expect(snapIntentFromPointer(1080, 400, band)).toEqual({ kind: 'right' })
    expect(snapIntentFromPointer(1060, 400, band)).toEqual({ kind: 'right' })
    expect(snapIntentFromPointer(1059, 400, band)).toBeNull()
  })

  it('顶缘判定带命中 → maximize（Top=最大化，复用整视口真全屏语义）', () => {
    expect(snapIntentFromPointer(580, 32, band)).toEqual({ kind: 'maximize' })
    expect(snapIntentFromPointer(580, 52, band)).toEqual({ kind: 'maximize' })
    expect(snapIntentFromPointer(580, 53, band)).toBeNull()
  })

  it('角落同进顶缘与左缘带：顶优先（先触顶）', () => {
    expect(snapIntentFromPointer(80, 32, band)).toEqual({ kind: 'maximize' })
  })

  it('带中央：null（不吸附）', () => {
    expect(snapIntentFromPointer(580, 400, band)).toBeNull()
  })
})
