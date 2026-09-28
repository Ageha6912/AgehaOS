import { describe, expect, it } from 'vitest'

import { buildFieldPlan, buildWallpaperPlan, COMPOSITIONS } from '../generative/templates'
import type { ContextSnapshot, WallpaperPlan } from '../types'
import {
  brightnessRangeFor,
  decorativeOverlapRatio,
  evaluateQuality,
  perceptualBrightness,
} from './quality-gate'

function snapshotOf(theme: 'light' | 'dark'): ContextSnapshot {
  return {
    contextVersion: 1,
    timePhase: 'day',
    season: 'autumn',
    theme,
    tier: 'mid',
    frozenAt: '2026-09-22T10:00:00.000Z',
  }
}

function planOf(paletteId: string, shapes: WallpaperPlan['shapes'] = []): WallpaperPlan {
  return {
    seed: 'test-seed',
    generatorVersion: 1,
    templateId: 'fluid-gradient@1',
    style: 'fluid-gradient',
    paletteId,
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    shapes,
    animation: { kind: 'none', flickerPerSec: 0 },
    reason: { signals: ['test'], palette: paletteId, motif: 'fluid-gradient' },
    zone: 'converge',
  }
}

describe('quality gate (§4.4，铁律 2)', () => {
  it('passes curated dark palettes under the dark theme', () => {
    for (const paletteId of ['midnight-ink', 'nebula-violet', 'deep-ocean']) {
      const result = evaluateQuality({ plan: planOf(paletteId), snapshot: snapshotOf('dark') })
      expect(result.violations, paletteId).toEqual([])
      expect(result.passed).toBe(true)
    }
  })

  it('passes curated light palettes under the light theme', () => {
    for (const paletteId of ['morning-mist', 'porcelain', 'citrus-dawn']) {
      const result = evaluateQuality({ plan: planOf(paletteId), snapshot: snapshotOf('light') })
      expect(result.violations, paletteId).toEqual([])
    }
  })

  it('rejects an unknown palette as a schema violation', () => {
    const result = evaluateQuality({ plan: planOf('no-such-palette'), snapshot: snapshotOf('dark') })
    expect(result.passed).toBe(false)
    expect(result.violations[0]?.item).toBe('schema')
  })

  it('rejects too-dark palettes under the light theme (brightness window)', () => {
    const result = evaluateQuality({ plan: planOf('midnight-ink'), snapshot: snapshotOf('light') })
    expect(result.passed).toBe(false)
    expect(result.violations.some((v) => v.item === 'brightness')).toBe(true)
  })

  it('rejects photosafety violations (flicker ≤3/s)', () => {
    const plan = { ...planOf('midnight-ink'), animation: { kind: 'slow-drift' as const, flickerPerSec: 5 } }
    const result = evaluateQuality({ plan, snapshot: snapshotOf('dark') })
    expect(result.violations.some((v) => v.item === 'flicker')).toBe(true)
  })

  it('rejects overlapping rectangular decorations (≥30%)', () => {
    const shapes: WallpaperPlan['shapes'] = [
      { kind: 'rect', x: 0, y: 0, w: 0.5, h: 0.5 },
      { kind: 'rect', x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    ]
    const plan = { ...planOf('midnight-ink'), shapes }
    const result = evaluateQuality({ plan, snapshot: snapshotOf('dark') })
    expect(result.violations.some((v) => v.item === 'overlap')).toBe(true)
    expect(decorativeOverlapRatio(shapes)).toBeGreaterThan(0.3)
  })

  it('ignores ridges and blending circles in the overlap metric', () => {
    const shapes: WallpaperPlan['shapes'] = [
      { kind: 'rect', x: 0, y: 0.4, w: 1, h: 0.6 },
      { kind: 'rect', x: 0, y: 0.6, w: 1, h: 0.4 },
      { kind: 'circle', x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
      { kind: 'circle', x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
    ]
    expect(decorativeOverlapRatio(shapes)).toBe(0)
  })

  it('keeps the theme-relative brightness windows documented in Phase A', () => {
    expect(brightnessRangeFor('dark')).toEqual({ min: 0.08, max: 0.85 })
    expect(brightnessRangeFor('light')).toEqual({ min: 0.55, max: 0.93 })
    expect(perceptualBrightness('#ffffff')).toBeCloseTo(1, 5)
    expect(perceptualBrightness('#000000')).toBeCloseTo(0, 5)
  })

  it('accepts a realistic generated plan end-to-end', () => {
    const generated = buildWallpaperPlan({
      seed: 'integration-seed',
      style: 'geometric',
      paletteId: 'slate-night',
      compositionId: COMPOSITIONS[3].id,
      density: 0.5,
      zone: 'converge',
      reason: { signals: ['time:day'], palette: 'slate-night', motif: 'geometric' },
    })
    const result = evaluateQuality({ plan: generated, snapshot: snapshotOf('dark') })
    expect(result.passed, result.violations.map((v) => v.detail).join('; ')).toBe(true)
  })
})

describe('quality gate: gradient-field plans (2026-09-27)', () => {
  it('passes when the composition theme matches the snapshot theme', () => {
    const plan = buildFieldPlan({
      seed: 's',
      fieldId: 'dawn-white',
      zone: 'converge',
      reason: { signals: [], palette: 'dawn-white', motif: 'gradient-field' },
    })
    const result = evaluateQuality({ plan, snapshot: snapshotOf('light') })
    expect(result.passed, result.violations.map((v) => v.detail).join('; ')).toBe(true)
  })

  it('fails the schema gate when the composition theme mismatches the snapshot theme', () => {
    const plan = buildFieldPlan({
      seed: 's',
      fieldId: 'night-veil',
      zone: 'converge',
      reason: { signals: [], palette: 'night-veil', motif: 'gradient-field' },
    })
    const result = evaluateQuality({ plan, snapshot: snapshotOf('light') })
    expect(result.passed).toBe(false)
    expect(result.violations[0]?.item).toBe('schema')
  })

  it('fails the schema gate on an unknown fieldId', () => {
    const plan = buildFieldPlan({
      seed: 's',
      fieldId: 'ghost',
      zone: 'converge',
      reason: { signals: [], palette: 'ghost', motif: 'gradient-field' },
    })
    const result = evaluateQuality({ plan, snapshot: snapshotOf('light') })
    expect(result.passed).toBe(false)
    expect(result.violations[0]?.detail).toContain('unknown field composition')
  })
})
