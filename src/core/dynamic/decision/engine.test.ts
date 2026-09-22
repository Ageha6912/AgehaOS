import { beforeEach, describe, expect, it } from 'vitest'

import { cappedStyleWeights, decideWallpaper, sliderBand, styleEntropy } from './engine'
import { paletteById } from '../generative/palettes'
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
    expect(retried.seed).not.toBe(first.seed)
  })

  it('short-circuits the fixed band with a fallback-zone plan', () => {
    const result = decideWallpaper({ ...BASE_INPUT, randomness: 0 })
    expect(result.zone).toBe('fallback')
  })

  it('never samples blocked styles (可行域)', () => {
    const blocked: WallpaperStyle[] = ['fluid-gradient', 'geometric', 'particle-nebula', 'grid-wavefield']
    for (let attempt = 1; attempt <= 8; attempt++) {
      const plan = decideWallpaper({ ...BASE_INPUT, blockedStyles: blocked, attempt }).plan
      expect(blocked).not.toContain(plan.style)
    }
  })

  it('filters palettes by theme (§2.1 权重 0.25 的硬性部分)', () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const dark = decideWallpaper({ ...BASE_INPUT, attempt }).plan
      expect(paletteById(dark.paletteId)?.family.lightness).toBe('dark')
      const light = decideWallpaper({ ...BASE_INPUT, attempt, snapshot: snapshotOf('light') }).plan
      expect(paletteById(light.paletteId)?.family.lightness).toBe('light')
    }
  })

  it('forces a far-exploration slot every 7th generation (§6.4 ②)', () => {
    const result = decideWallpaper({ ...BASE_INPUT, generationOrdinal: 7 })
    expect(result.zone).toBe('far')
  })

  it('forces global sampling when recent entropy drops below 1.5 bits (§6.4 ③)', () => {
    expect(styleEntropy(['fluid-gradient', 'fluid-gradient'])).toBe(0)
    expect(styleEntropy(['fluid-gradient', 'geometric'])).toBeCloseTo(1, 5)
    const result = decideWallpaper({
      ...BASE_INPUT,
      recentStyles: ['fluid-gradient', 'fluid-gradient', 'fluid-gradient'],
    })
    expect(result.zone).toBe('far')
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
