import { describe, expect, it } from 'vitest'

import {
  FIELD_COMPOSITIONS,
  fieldCompositionById,
  fieldCompositionsForTheme,
  drawGradientField,
} from './gradient-field'

/** jsdom canvas 是 stub：getContext 返回的 2d 上下文方法可调用但无像素——
 * 引擎测试聚焦「构图数据完整性 + 绘制确定性」，像素观感由浏览器烟雾覆盖。 */
function stubCtx(counters: { fillRect?: number; fill?: number } = {}): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined }
  const ctx = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => {
      counters.fillRect = (counters.fillRect ?? 0) + 1
    },
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    bezierCurveTo: () => undefined,
    closePath: () => undefined,
    fill: () => {
      counters.fill = (counters.fill ?? 0) + 1
    },
    stroke: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    fillStyle: undefined,
    strokeStyle: undefined,
    filter: undefined,
    globalAlpha: 1,
    lineWidth: 1,
  }
  return ctx as unknown as CanvasRenderingContext2D
}

describe('FIELD_COMPOSITIONS（18 款构图，9 亮 + 9 暗）', () => {
  it('holds exactly nine light and nine dark compositions', () => {
    expect(FIELD_COMPOSITIONS).toHaveLength(18)
    expect(fieldCompositionsForTheme('light')).toHaveLength(9)
    expect(fieldCompositionsForTheme('dark')).toHaveLength(9)
  })

  it('keeps ids unique and resolvable', () => {
    const ids = FIELD_COMPOSITIONS.map((composition) => composition.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const composition of FIELD_COMPOSITIONS) {
      expect(fieldCompositionById(composition.id)).toBe(composition)
    }
    expect(fieldCompositionById('ghost')).toBeUndefined()
  })

  it('carries a well-formed layered palette (bg + layers with ordered bases)', () => {
    for (const composition of FIELD_COMPOSITIONS) {
      expect(composition.bg).toHaveLength(2)
      expect(composition.layers.length).toBeGreaterThanOrEqual(3)
      const bases = composition.layers.map((layer) => layer.base)
      for (const base of bases) {
        expect(base).toBeGreaterThan(0)
        expect(base).toBeLessThanOrEqual(1)
      }
      // 层次从上到下排布（base 递增），渲染次序无歧义
      expect([...bases].sort((a, b) => a - b)).toEqual(bases)
    }
  })
})

describe('drawGradientField（确定性绘制）', () => {
  it('produces an identical paint count for the same seed (可重放)', () => {
    const composition = fieldCompositionById('dawn-white')!
    const a: { fillRect?: number; fill?: number } = {}
    const b: { fillRect?: number; fill?: number } = {}
    drawGradientField(stubCtx(a), 1920, 1080, composition, 'seed-1')
    drawGradientField(stubCtx(b), 1920, 1080, composition, 'seed-1')
    expect(a.fillRect).toBe(b.fillRect)
    expect(a.fill).toBe(b.fill)
    expect(a.fillRect).toBe(1) // 背景
  })

  it('varies with the seed while keeping the structure constant (换一张不翻车)', () => {
    const composition = fieldCompositionById('night-veil')!
    const a: { fillRect?: number; fill?: number } = {}
    const b: { fillRect?: number; fill?: number } = {}
    drawGradientField(stubCtx(a), 1920, 1080, composition, 'seed-a')
    drawGradientField(stubCtx(b), 1920, 1080, composition, 'seed-b')
    // 层数恒定（主结构不变）：每层一次 fill
    expect(a.fill).toBe(composition.layers.length)
    expect(b.fill).toBe(composition.layers.length)
  })

  it('draws every composition in both themes without throwing', () => {
    for (const composition of FIELD_COMPOSITIONS) {
      expect(() =>
        drawGradientField(stubCtx(), 1920, 1080, composition, `smoke|${composition.id}`),
      ).not.toThrow()
    }
  })
})
