import { describe, expect, it } from 'vitest'

import { mulberry32 } from './seed'
import {
  buildLandscapeScene,
  buildShapes,
  buildWallpaperPlan,
  ridgeLine,
  COMPOSITIONS,
} from './templates'
import { PALETTES, paletteById } from './palettes'
import { evaluateQuality } from '../governance/quality-gate'
import type { PlanShape } from '../types'

const LANDSCAPE_PALETTES = PALETTES.filter((p) => p.ridge !== undefined)

function kindsOf(shapes: PlanShape[]): string[] {
  return shapes.map((shape) => shape.kind)
}

describe('ridgeLine (中点位移山脊线)', () => {
  it('is deterministic and normalized to [0,1]', () => {
    const rng = mulberry32('ridge-seed')
    const points = ridgeLine(rng, 0.8)
    const rng2 = mulberry32('ridge-seed')
    expect(ridgeLine(rng2, 0.8)).toEqual(points)

    expect(points).toHaveLength(130) // 65 点 × (x,y)：倍增到 ≥48 段
    for (let i = 0; i < points.length; i += 2) {
      expect(points[i]).toBeGreaterThanOrEqual(0)
      expect(points[i]).toBeLessThanOrEqual(1)
      expect(points[i + 1]).toBeGreaterThanOrEqual(0)
      expect(points[i + 1]).toBeLessThanOrEqual(1)
    }
  })

  it('differs across seeds', () => {
    expect(ridgeLine(mulberry32('a'), 0.8)).not.toEqual(ridgeLine(mulberry32('b'), 0.8))
  })
})

describe('buildLandscapeScene (山水引擎 Phase A.5)', () => {
  it('is deterministic for the same rng state', () => {
    const first = buildLandscapeScene(mulberry32('scene-1'), 0.5, 'shanshui-day')
    const second = buildLandscapeScene(mulberry32('scene-1'), 0.5, 'shanshui-day')
    expect(second).toEqual(first)
  })

  it('always paints sky → celestial → three ridges, in that relative order', () => {
    for (const palette of LANDSCAPE_PALETTES) {
      for (const seed of ['s1', 's2', 's3']) {
        const kinds = kindsOf(buildLandscapeScene(mulberry32(seed), 0.5, palette.id))
        expect(kinds[0]).toBe('sky')
        expect(kinds).toContain('celestial')
        const firstRidge = kinds.indexOf('ridge')
        expect(kinds.filter((kind) => kind === 'ridge')).toHaveLength(3)
        expect(kinds.lastIndexOf('celestial')).toBeLessThan(firstRidge)
      }
    }
  })

  it('renders stars only for night palettes and birds only for day palettes', () => {
    for (const palette of LANDSCAPE_PALETTES) {
      for (let seed = 0; seed < 8; seed++) {
        const kinds = kindsOf(buildLandscapeScene(mulberry32(`n${seed}`), 0.5, palette.id))
        if (palette.night) {
          expect(kinds).toContain('stars')
          expect(kinds).not.toContain('birds')
        } else {
          expect(kinds).not.toContain('stars')
        }
      }
    }
  })

  it('keeps ridge colors inside the palette ramp and celestial on the palette sun', () => {
    const palette = paletteById('shanshui-dusk')
    const shapes = buildLandscapeScene(mulberry32('colors'), 0.5, 'shanshui-dusk')
    const ridges = shapes.filter((s): s is Extract<PlanShape, { kind: 'ridge' }> => s.kind === 'ridge')
    expect(ridges).toHaveLength(3)
    for (const ridgeShape of ridges) {
      expect(palette?.ridge).toContain(ridgeShape.color)
    }
    const celestial = shapes.find((s) => s.kind === 'celestial')
    expect(celestial).toMatchObject({ color: palette?.sun })
  })

  it('keeps the serialized plan compact (<32KB, VFS history budget)', () => {
    for (const palette of LANDSCAPE_PALETTES) {
      const plan = buildWallpaperPlan({
        seed: `budget-${palette.id}`,
        style: 'landscape',
        paletteId: palette.id,
        compositionId: COMPOSITIONS[0].id,
        density: 0.9,
        zone: 'converge',
        reason: { signals: [], palette: palette.id, motif: 'landscape' },
      })
      expect(JSON.stringify(plan).length).toBeLessThan(32 * 1024)
    }
  })
})

describe('landscape style integration (决策域 + 质量门)', () => {
  it('buildShapes routes landscape to the scene builder', () => {
    const viaGeneric = buildShapes('landscape', 'route', COMPOSITIONS[0], 0.5, 'shanshui-ink')
    expect(kindsOf(viaGeneric)[0]).toBe('sky')
  })

  it('every landscape palette passes the quality gate in its own theme', () => {
    for (const palette of LANDSCAPE_PALETTES) {
      const theme = palette.family.lightness === 'dark' ? 'dark' : 'light'
      const plan = buildWallpaperPlan({
        seed: `gate-${palette.id}`,
        style: 'landscape',
        paletteId: palette.id,
        compositionId: COMPOSITIONS[0].id,
        density: 0.5,
        zone: 'converge',
        reason: { signals: [], palette: palette.id, motif: 'landscape' },
      })
      const result = evaluateQuality({
        plan,
        snapshot: { theme },
      })
      expect(result.violations.map((v) => `${v.item}:${v.detail}`)).toEqual([])
    }
  })
})
