import { beforeEach, describe, expect, it } from 'vitest'

import { cappedStyleWeights, ACTIVE_STYLES, decideWallpaper, pickFieldId, sliderBand, styleEntropy } from './engine'
import { fieldCompositionById, fieldCompositionsForTheme } from '../generative/gradient-field'
import type { ContextSnapshot, PreferenceProfile, WallpaperStyle } from '../types'
import { emptyProfile } from '../feedback/weights'
import { resetContextVersion } from '../context/snapshot'

beforeEach(() => {
  resetContextVersion()
})

function snapshotOf(theme: 'light' | 'dark' = 'dark'): ContextSnapshot {
  return {
    contextVersion: 7,
    timePhase: 'day',
    season: 'autumn',
    theme,
    tier: 'mid',
    frozenAt: '2026-09-22T10:00:00.000Z',
  }
}

const BASE_INPUT = {
  sessionSeed: 'session-seed-1',
  contextVersion: 7,
  attempt: 1,
  snapshot: snapshotOf('dark'),
  blockedStyles: [] as string[],
  randomness: 40,
  profile: emptyProfile(),
  generationOrdinal: 1,
  recentStyles: [] as WallpaperStyle[],
}

describe('slider band mapping (§6.3)', () => {
  it('maps the five bands and their zone ratios', () => {
    expect(sliderBand(0).band).toBe('fixed')
    expect(sliderBand(10).band).toBe('fine')
    expect(sliderBand(40)).toEqual({
      band: 'balanced',
      zones: { converge: 0.7, adjacent: 0.2, far: 0.1 },
      epsilonCap: 0.15,
    })
    expect(sliderBand(26).band).toBe('balanced')
    expect(sliderBand(61).band).toBe('explore')
    expect(sliderBand(90).band).toBe('explore')
    expect(sliderBand(91).band).toBe('wild')
    expect(sliderBand(100).band).toBe('wild')
  })
})

describe('decideWallpaper determinism (验收 ③)', () => {
  it('returns identical plans for identical inputs and reacts to attempt changes', () => {
    const first = decideWallpaper(BASE_INPUT).plan
    const second = decideWallpaper(BASE_INPUT).plan
    expect(second).toEqual(first)
    const retried = decideWallpaper({ ...BASE_INPUT, attempt: 2 }).plan
    expect(retried?.seed).not.toBe(first?.seed)
  })

  it('short-circuits the fixed band within the active style domain (B3 审查)', () => {
    const result = decideWallpaper({ ...BASE_INPUT, randomness: 0 })
    expect(result.zone).toBe('fallback')
    // 旧实现给已退役的 landscape/shanshui-dawn；现给当前主题的 field 兜底。
    expect(result.plan?.style).toBe('gradient-field')
    expect(fieldCompositionById(result.plan?.fieldId ?? '')?.theme).toBe('dark')
  })

  it('returns no suggestion when blocking empties the active domain (B3 审查)', () => {
    const blocked = [...ACTIVE_STYLES] as WallpaperStyle[]
    const result = decideWallpaper({ ...BASE_INPUT, blockedStyles: blocked })
    expect(result.plan).toBeNull()
    expect(result.zone).toBe('fallback')
  })

  it('never samples blocked styles (可行域)', () => {
    const blocked: WallpaperStyle[] = ['fluid-gradient', 'geometric', 'particle-nebula', 'grid-wavefield']
    for (let attempt = 1; attempt <= 8; attempt++) {
      const plan = decideWallpaper({ ...BASE_INPUT, blockedStyles: blocked, attempt }).plan
      expect(blocked).not.toContain(plan?.style)
    }
  })

  it('filters field compositions by theme (§2.1 权重 0.25 的硬性部分，gradient-field 域)', () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const dark = decideWallpaper({ ...BASE_INPUT, attempt }).plan
      expect(dark?.style).toBe('gradient-field')
      expect(fieldCompositionById(dark?.fieldId ?? '')?.theme).toBe('dark')
      const light = decideWallpaper({ ...BASE_INPUT, attempt, snapshot: snapshotOf('light') }).plan
      expect(fieldCompositionById(light?.fieldId ?? '')?.theme).toBe('light')
    }
  })

  it('samples only the active style domain (Phase A.6 裁决：照片为主动样域)', () => {
    expect(ACTIVE_STYLES).toEqual(['gradient-field'])
    for (let attempt = 1; attempt <= 8; attempt++) {
      expect(decideWallpaper({ ...BASE_INPUT, attempt }).plan?.style).toBe('gradient-field')
    }
  })

  it('avoids recently used compositions when the theme pool allows (防短期重复)', () => {
    const recent = fieldCompositionsForTheme('dark').slice(0, 4).map((composition) => composition.id)
    for (let attempt = 1; attempt <= 12; attempt++) {
      const plan = decideWallpaper({ ...BASE_INPUT, attempt, recentFieldIds: recent }).plan
      expect(recent).not.toContain(plan?.fieldId)
    }
  })

  it('reopens the pool when every theme member is recent (finite 池放开)', () => {
    const all = fieldCompositionsForTheme('dark').map((composition) => composition.id)
    for (let attempt = 1; attempt <= 8; attempt++) {
      const plan = decideWallpaper({ ...BASE_INPUT, attempt, recentFieldIds: all }).plan
      expect(all).toContain(plan?.fieldId)
    }
  })

  it('weights field sampling by profile tags (B3 审查)', () => {
    const pool = fieldCompositionsForTheme('dark')
    const target = pool[pool.length - 1]!
    // 大权重把 rng=0.5 的落点拉到目标构图（基线 1 + 1000）。
    expect(pickFieldId('dark', [], () => 0.5, { [`field:${target.id}`]: 1000 })).toBe(target.id)
  })

  it('pickFieldId stays inside the catalog for both themes (含种子确定性)', () => {
    const darkFirst = pickFieldId('dark', [], () => 0.1)
    const darkAgain = pickFieldId('dark', [], () => 0.1)
    expect(darkAgain).toBe(darkFirst)
    for (const theme of ['dark', 'light'] as const) {
      for (const roll of [0, 0.5, 0.999]) {
        const id = pickFieldId(theme, [], () => roll)
        expect(fieldCompositionById(id)?.theme).toBe(theme)
      }
    }
  })

  it('forces a far-exploration slot every 7th generation (§6.4 ②)', () => {
    const result = decideWallpaper({ ...BASE_INPUT, generationOrdinal: 7 })
    expect(result.zone).toBe('far')
  })

  it('skips the entropy floor while a single style is active (§6.4 ③，B3 审查)', () => {
    expect(styleEntropy(['fluid-gradient', 'fluid-gradient'])).toBe(0)
    expect(styleEntropy(['fluid-gradient', 'geometric'])).toBeCloseTo(1, 5)
    // 单风格域熵恒 0：旧实现从第二次起每次强制 zone='far'；现在收敛区/ε
    // 仍可命中，只有 ≥2 风格时熵保底才生效。
    const recentStyles = ['gradient-field', 'gradient-field', 'gradient-field'] as WallpaperStyle[]
    const zones = new Set(
      Array.from({ length: 8 }, (_, index) =>
        decideWallpaper({ ...BASE_INPUT, attempt: index + 1, recentStyles }).zone,
      ),
    )
    expect([...zones].some((zone) => zone !== 'far')).toBe(true)
  })
})

describe('polarization cap (§10.3)', () => {
  it('caps the top tag share at 35% and spreads the excess to the rest', () => {
    const profile: PreferenceProfile = {
      ...emptyProfile(),
      tags: { 'fluid-gradient': 100, geometric: 10, 'grid-wavefield': 10 },
    }
    const weights = cappedStyleWeights(profile)
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    for (const share of Object.values(weights).map((w) => w / total)) {
      expect(share).toBeLessThanOrEqual(0.35 + 1e-9)
    }
    expect(weights.geometric).toBeGreaterThan(10)
  })

  it('returns an empty vector for cold-start profiles', () => {
    expect(cappedStyleWeights(emptyProfile())).toEqual({})
  })
})
