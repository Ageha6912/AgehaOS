import { describe, expect, it } from 'vitest'

import { generateWallpaper } from './pipeline'
import type { Emit } from './pipeline'
import { buildWallpaperPlan, COMPOSITIONS } from './templates'
import { curatedPlans, staticGradientPlan } from './fallbacks'
import type { ContextSnapshot, WallpaperPlan } from '../types'
import { emptyProfile } from '../feedback/weights'

interface RecordedEvent {
  name: string
  payload: Record<string, unknown>
}

// 事件记录器：核对兜底链逐级触发的对应事件（验收 ④）。
function recorder() {
  const events: RecordedEvent[] = []
  const emit: Emit = (eventName, payload) =>
    events.push({ name: eventName, payload: payload as Record<string, unknown> })
  return { events, emit }
}

function snapshotOf(theme: 'light' | 'dark' = 'dark'): ContextSnapshot {
  return {
    contextVersion: 3,
    timePhase: 'day',
    season: 'autumn',
    theme,
    tier: 'mid',
    frozenAt: '2026-09-22T10:00:00.000Z',
  }
}

const BASE = {
  sessionSeed: 'session-1',
  snapshot: snapshotOf('dark'),
  trigger: 'login' as const,
  blockedStyles: [] as string[],
  randomness: 40,
  profile: emptyProfile(),
  generationOrdinal: 1,
  recentStyles: [] as WallpaperPlan['style'][],
}

function goodPlan(seed = 'good-1'): WallpaperPlan {
  return buildWallpaperPlan({
    seed,
    style: 'geometric',
    paletteId: 'slate-night',
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    zone: 'converge',
    reason: { signals: ['time:day'], palette: 'slate-night', motif: 'geometric' },
  })
}

const NOW = () => new Date('2026-09-22T10:00:00Z')

describe('generation pipeline (§4.2 + §9.1，验收 ④)', () => {
  it('applies a gate-passed plan as L0 with the full event trail', () => {
    const { events, emit } = recorder()
    const outcome = generateWallpaper(BASE, { emit, now: NOW, lastGoodPlan: null })
    expect(outcome.level).toBe('L0')
    expect(outcome.decisionSource).toBe('local')
    expect(events.map((e) => e.name)).toEqual([
      'desktop.wallpaper.generate-started',
      'desktop.wallpaper.generated',
      'desktop.wallpaper.applied',
    ])
    expect(events[2]?.payload).toMatchObject({ seed: outcome.plan.seed, tier: 'mid' })
    expect(events[2]?.payload.durationMs).toBeTypeOf('number')
  })

  it('falls back to F1 (replay of the last good plan) after 3 failed attempts', () => {
    const { events, emit } = recorder()
    const lastGood = goodPlan('replay-me')
    const outcome = generateWallpaper(BASE, {
      emit,
      now: NOW,
      lastGoodPlan: lastGood,
      sample: () => null,
    })
    expect(outcome.level).toBe('F1')
    expect(outcome.decisionSource).toBe('cache')
    expect(outcome.plan).toEqual(lastGood)
    const failed = events.filter((e) => e.name === 'desktop.generation.failed')
    expect(failed).toHaveLength(3)
    expect(events.some((e) => e.name === 'desktop.wallpaper.fallback' && e.payload.to === 'F1')).toBe(true)
  })

  it('falls back to F2 (curated set) when no history exists, matching the theme and the gate', () => {
    const { events, emit } = recorder()
    const outcome = generateWallpaper(BASE, {
      emit,
      now: NOW,
      lastGoodPlan: null,
      sample: () => null,
    })
    expect(outcome.level).toBe('F2')
    expect(outcome.plan.reason.signals).toContain('theme:dark')
    expect(events.some((e) => e.name === 'desktop.wallpaper.fallback' && e.payload.to === 'F2')).toBe(true)
  })

  it('falls back to F3 (static gradient) when the curated set is unavailable', () => {
    const { events, emit } = recorder()
    const outcome = generateWallpaper(BASE, {
      emit,
      now: NOW,
      lastGoodPlan: null,
      sample: () => null,
      curated: [],
    })
    expect(outcome.level).toBe('F3')
    expect(outcome.plan.paletteId).toBe('static-gradient-dark')
    expect(events.some((e) => e.name === 'desktop.wallpaper.fallback' && e.payload.to === 'F3')).toBe(true)
  })

  it('picks a light curated plan for the light theme', () => {
    const outcome = generateWallpaper(
      { ...BASE, snapshot: snapshotOf('light') },
      { emit: recorder().emit, now: NOW, lastGoodPlan: null, sample: () => null },
    )
    expect(outcome.level).toBe('F2')
    expect(outcome.plan.reason.signals).toContain('theme:light')
  })

  it('safety-rejects blocked styles and degrades instead of applying them', () => {
    const { events, emit } = recorder()
    const blocked = { ...goodPlan(), style: 'geometric' as const }
    const outcome = generateWallpaper(
      { ...BASE, blockedStyles: ['geometric'] },
      { emit, now: NOW, lastGoodPlan: null, sample: () => blocked, curated: curatedPlans() },
    )
    expect(outcome.level).toBe('F2')
    expect(events.filter((e) => e.name === 'desktop.generation.failed')).toHaveLength(3)
  })

  it('F1 skips a blocked last-good plan and falls through to F2', () => {
    const blocked = { ...goodPlan('blocked-replay'), style: 'geometric' as const }
    const outcome = generateWallpaper(
      { ...BASE, blockedStyles: ['geometric'] },
      {
        emit: recorder().emit,
        now: NOW,
        lastGoodPlan: blocked,
        sample: () => null,
        curated: curatedPlans(),
      },
    )
    expect(outcome.level).toBe('F2')
    expect(outcome.plan.style).not.toBe('geometric')
  })

  it('treats an emptied active domain as sampling failure and falls through the chain (B3 审查)', () => {
    // 屏蔽唯一启用风格：决策器返回 null（不再域外补 fluid-gradient），管线
    // 走兜底链，绝不把被屏蔽的梯度场重新端回来。
    const outcome = generateWallpaper(
      { ...BASE, blockedStyles: ['gradient-field'] },
      { emit: recorder().emit, now: NOW, lastGoodPlan: null, curated: curatedPlans() },
    )
    expect(outcome.plan.style).not.toBe('gradient-field')
    expect(['F2', 'F3']).toContain(outcome.level)
  })

  it('F2 filters blocked styles out; all-blocked curated set falls to F3', () => {
    const blocked = { ...goodPlan('blocked-curated'), style: 'geometric' as const }
    const outcome = generateWallpaper(
      { ...BASE, blockedStyles: ['geometric'] },
      {
        emit: recorder().emit,
        now: NOW,
        lastGoodPlan: null,
        sample: () => null,
        curated: [blocked],
      },
    )
    expect(outcome.level).toBe('F3')
  })

  it('always returns the constant static gradient for F3', () => {
    expect(staticGradientPlan('dark').paletteId).toBe('static-gradient-dark')
    expect(staticGradientPlan('light').paletteId).toBe('static-gradient-light')
    expect(staticGradientPlan('dark')).toEqual(staticGradientPlan('dark'))
  })
})
