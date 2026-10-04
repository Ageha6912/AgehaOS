import { describe, expect, it } from 'vitest'

import { buildDisplacementMapDataUri, displacementAt, edgeCurve, LIQUID_MAP_DEFAULTS, roundedRectSDF } from './liquid-glass'

const O = { width: 176, height: 520, radius: 20, band: 14, strength: 10 }

describe('liquid-glass（system-rails 液态玻璃位移图）', () => {
  it('roundedRectSDF：内部为负、外部为正、边缘≈0', () => {
    expect(roundedRectSDF(88, 260, 176, 520, 20)).toBeLessThan(-80) // 深处（最近边 88px）
    expect(roundedRectSDF(88, 5, 176, 520, 20)).toBeLessThan(0) // 顶缘内侧 5px
    expect(roundedRectSDF(-10, 260, 176, 520, 20)).toBeGreaterThan(0) // 外部
    // 顶边中点边界（y=0）距离≈0。
    expect(Math.abs(roundedRectSDF(88, 0, 176, 520, 20))).toBeLessThan(1)
  })

  it('edgeCurve：clamp 到 [0,1]，中点取 0.5（smoothstep）', () => {
    expect(edgeCurve(-1)).toBe(0)
    expect(edgeCurve(0)).toBe(0)
    expect(edgeCurve(0.5)).toBe(0.5)
    expect(edgeCurve(1)).toBe(1)
    expect(edgeCurve(2)).toBe(1)
  })

  it('displacementAt：深处为零、边缘带沿外法线、上限 = strength', () => {
    // 深处（远离边缘带）中性。
    const deep = displacementAt(88, 260, O)
    expect(deep.dx).toBe(0)
    expect(deep.dy).toBe(0)
    // 顶缘带内（y=5，距边 5px < band 14）：沿外法线向上。
    const top = displacementAt(88, 5, O)
    expect(top.dy).toBeLessThan(0)
    expect(top.dx).toBe(0)
    expect(Math.abs(top.dy)).toBeLessThanOrEqual(O.strength)
    // 左缘带内：沿外法线向左。
    const left = displacementAt(5, 260, O)
    expect(left.dx).toBeLessThan(0)
    expect(left.dy).toBe(0)
    // 越靠外折射越强（单调爬升到最外缘）。
    const near = Math.abs(displacementAt(88, 12, O).dy)
    const nearer = Math.abs(displacementAt(88, 7, O).dy)
    expect(nearer).toBeGreaterThan(near)
    // 角区（圆角处）：法线为对角方向（dx、dy 同非零）。
    const corner = displacementAt(6, 6, O)
    expect(corner.dx).toBeLessThan(0)
    expect(corner.dy).toBeLessThan(0)
  })

  it('buildDisplacementMapDataUri：jsdom 无 canvas 返回空串（调用方回落毛玻璃）', () => {
    expect(buildDisplacementMapDataUri(LIQUID_MAP_DEFAULTS)).toBe('')
  })
})
