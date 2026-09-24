import { describe, expect, it } from 'vitest'

import { buildPhotoPlan, buildWallpaperPlan, COMPOSITIONS } from '../generative/templates'
import { safetyFilter, validatePlanSchema } from './filter'
import type { WallpaperPlan } from '../types'

function planOf(style: WallpaperPlan['style'], paletteId: string): WallpaperPlan {
  return buildWallpaperPlan({
    seed: 'safety-seed',
    style,
    paletteId,
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    zone: 'converge',
    reason: { signals: [], palette: paletteId, motif: style },
  })
}

describe('safety filter (§8.4，铁律 7)', () => {
  it('allows a schema-valid, unblocked plan', () => {
    const result = safetyFilter({ plan: planOf('fluid-gradient', 'midnight-ink'), blockedStyles: [] })
    expect(result).toEqual({ allowed: true })
  })

  it('rejects unknown palettes at the schema gate', () => {
    const plan = { ...planOf('fluid-gradient', 'midnight-ink'), paletteId: 'hijacked' }
    expect(validatePlanSchema(plan)).toContain('unknown palette')
    expect(safetyFilter({ plan, blockedStyles: [] })).toEqual({ allowed: false, reason: 'schema' })
  })

  it('rejects unknown styles and densities', () => {
    expect(
      validatePlanSchema({ ...planOf('fluid-gradient', 'midnight-ink'), style: 'hijacked' as WallpaperPlan['style'] }),
    ).toContain('unknown style')
    expect(
      validatePlanSchema({ ...planOf('fluid-gradient', 'midnight-ink'), density: 0.42 }),
    ).toContain('unknown density')
  })

  it('rejects blocked styles (屏蔽名单)', () => {
    const result = safetyFilter({
      plan: planOf('particle-nebula', 'nebula-violet'),
      blockedStyles: ['particle-nebula'],
    })
    expect(result).toEqual({ allowed: false, reason: 'blocked-style' })
  })

  it('enforces the photosafety limit at the schema layer', () => {
    const plan = {
      ...planOf('fluid-gradient', 'midnight-ink'),
      animation: { kind: 'slow-drift' as const, flickerPerSec: 4 },
    }
    expect(validatePlanSchema(plan)).toContain('photosafety')
  })
})

describe('photo plan schema (Phase A.6 照片域)', () => {
  it('allows a photo plan whose photoId is in the catalog', () => {
    const plan = buildPhotoPlan({
      seed: 's',
      photoId: 'yamzho-yumco',
      zone: 'converge',
      reason: { signals: [], palette: 'yamzho-yumco', motif: 'photo' },
    })
    expect(safetyFilter({ plan, blockedStyles: [] })).toEqual({ allowed: true })
  })

  it('rejects a photo plan with an unknown photoId at the schema gate', () => {
    const plan = buildPhotoPlan({
      seed: 's',
      photoId: 'no-such-photo',
      zone: 'converge',
      reason: { signals: [], palette: 'no-such-photo', motif: 'photo' },
    })
    expect(validatePlanSchema(plan)).toMatch(/unknown photo/)
    expect(safetyFilter({ plan, blockedStyles: [] }).reason).toBe('schema')
  })

  it('blocks the photo style via the style blocklist like any other style', () => {
    const plan = buildPhotoPlan({
      seed: 's',
      photoId: 'yamzho-yumco',
      zone: 'converge',
      reason: { signals: [], palette: 'yamzho-yumco', motif: 'photo' },
    })
    expect(safetyFilter({ plan, blockedStyles: ['photo'] }).reason).toBe('blocked-style')
  })
})
