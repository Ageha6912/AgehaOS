import { describe, expect, it } from 'vitest'

import { buildShapes, buildWallpaperPlan, COMPOSITIONS, templateIdOf } from './templates'
import { WALLPAPER_STYLES } from '../types'
import type { WallpaperStyle } from '../types'

describe('wallpaper plan builder (§4.3 确定性，验收 ③)', () => {
  const params = {
    seed: 'domain-seed-1',
    style: 'fluid-gradient' as WallpaperStyle,
    paletteId: 'midnight-ink',
    compositionId: 'thirds-nw',
    density: 0.5,
    zone: 'converge' as const,
    reason: { signals: ['time:day'], palette: 'midnight-ink', motif: 'fluid-gradient' as const },
  }

  it('produces a parameter-identical plan for the same seed (snapshot assertion)', () => {
    const first = buildWallpaperPlan(params)
    const second = buildWallpaperPlan(params)
    expect(second).toEqual(first)
    expect(second.templateId).toBe('fluid-gradient@1')
    expect(second.generatorVersion).toBe(1)
  })

  it('stamps the triple (seed, generatorVersion, templateId) used for replay', () => {
    const plan = buildWallpaperPlan(params)
    expect(plan.seed).toBe('domain-seed-1')
    expect(templateIdOf(plan.style)).toBe(plan.templateId)
  })
})

describe('shape generation', () => {
  const composition = COMPOSITIONS[0]

  it('is deterministic for a given style+seed and differs across seeds', () => {
    for (const style of WALLPAPER_STYLES) {
      const shapes = buildShapes(style, 's1', composition, 0.5)
      expect(buildShapes(style, 's1', composition, 0.5)).toEqual(shapes)
    }
    // 不同种子至少在一个风格上产生不同图元（网格瓦片仅尺寸随机，允许个别风格巧合一致）。
    const differs = WALLPAPER_STYLES.some(
      (style) =>
        JSON.stringify(buildShapes(style, 's1', composition, 0.5)) !==
        JSON.stringify(buildShapes(style, 'vastly-different-seed', composition, 0.5)),
    )
    expect(differs).toBe(true)
  })

  it('keeps shapes inside the unit square', () => {
    for (const style of WALLPAPER_STYLES) {
      for (const shape of buildShapes(style, 'bounds', composition, 0.9)) {
        expect(shape.x).toBeGreaterThanOrEqual(0)
        expect(shape.y).toBeGreaterThanOrEqual(0)
        expect(shape.y).toBeLessThan(1)
        expect(shape.w).toBeGreaterThan(0)
        expect(shape.h).toBeGreaterThan(0)
      }
    }
  })

  it('scales particle count with density', () => {
    const sparse = buildShapes('particle-nebula', 's', composition, 0.1).length
    const dense = buildShapes('particle-nebula', 's', composition, 0.9).length
    expect(dense).toBeGreaterThan(sparse)
  })

  it('mountains layer as full-width bands, geometric tiles stay disjoint', () => {
    const ridges = buildShapes('mountain-silhouette', 'm', composition, 0.5)
    expect(ridges.length).toBeGreaterThanOrEqual(3)
    expect(ridges.every((s) => s.kind === 'rect' && s.w === 1)).toBe(true)

    const tiles = buildShapes('geometric', 'g', composition, 0.5).filter((s) => s.kind === 'rect')
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i]
        const b = tiles[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(overlapX <= 0 || overlapY <= 0).toBe(true)
      }
    }
  })
})
