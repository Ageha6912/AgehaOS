import { describe, expect, it } from 'vitest'

import { applyFeedbackSignal, emptyProfile, SIGNAL_WEIGHTS } from './weights'

const NOW = new Date('2026-09-22T10:00:00Z')

describe('feedback weights (§10.2)', () => {
  it('documents the unified weight table', () => {
    expect(SIGNAL_WEIGHTS).toEqual({
      pin: 10,
      like: 3,
      dislike: -4,
      'block-style': -8,
      report: -5,
      refresh: -1.5,
      'session-skip': -1,
      'long-stay': 1,
    })
  })

  it('adds the clamped weight to the target tags', () => {
    const profile = applyFeedbackSignal({
      profile: emptyProfile(),
      signal: 'like',
      targetTags: ['fluid-gradient'],
      now: NOW,
    })
    expect(profile.tags['fluid-gradient']).toBe(3)
    expect(profile.totalCount).toBe(1)
    expect(profile.explicitCount).toBe(1)
    expect(profile.lastSignalAt).toBe(NOW.toISOString())
  })

  it('keeps the pin weight 10 while clamping other single signals to ±6 (§10.2/§10.3)', () => {
    // pin 是显式重申（权重 10），不被单信号钳制截成 6（B3 审查）。
    const pinned = applyFeedbackSignal({
      profile: emptyProfile(),
      signal: 'pin',
      targetTags: ['fluid-gradient'],
      now: NOW,
    })
    expect(pinned.tags['fluid-gradient']).toBe(10)
    expect(pinned.explicitCount).toBe(1)

    const blocked = applyFeedbackSignal({
      profile: emptyProfile(),
      signal: 'block-style',
      targetTags: ['particle-nebula'],
      now: NOW,
    })
    expect(blocked.tags['particle-nebula']).toBe(-6)
  })

  it('caps the per-session cumulative delta per tag at ±6 (B3 审查)', () => {
    let profile = emptyProfile()
    const sessionDeltas: Record<string, number> = {}
    // refresh(-1.5) 连点：1.5×4 即触及 -6 会话预算，之后不再叠加。
    for (let i = 0; i < 8; i += 1) {
      const before = profile.tags['field:dawn-white'] ?? 0
      profile = applyFeedbackSignal({
        profile,
        signal: 'refresh',
        targetTags: ['field:dawn-white'],
        sessionDeltas,
        now: NOW,
      })
      const delta = (profile.tags['field:dawn-white'] ?? 0) - before
      sessionDeltas['field:dawn-white'] = (sessionDeltas['field:dawn-white'] ?? 0) + delta
    }
    expect(profile.tags['field:dawn-white']).toBe(-6)
  })

  it('accumulates negative signals and family counters', () => {
    let profile = emptyProfile()
    profile = applyFeedbackSignal({
      profile,
      signal: 'block-style',
      targetTags: ['particle-nebula'],
      targetFamily: 'dark:high',
      now: NOW,
    })
    profile = applyFeedbackSignal({
      profile,
      signal: 'session-skip',
      targetTags: ['particle-nebula'],
      targetFamily: 'dark:high',
      now: NOW,
    })
    expect(profile.tags['particle-nebula']).toBe(-7)
    expect(profile.families['dark:high']).toBe(-2)
    expect(profile.totalCount).toBe(2)
    expect(profile.explicitCount).toBe(1)
  })

  it('treats long-stay as implicit (no explicit count)', () => {
    const profile = applyFeedbackSignal({
      profile: emptyProfile(),
      signal: 'long-stay',
      targetTags: ['geometric'],
      now: NOW,
    })
    expect(profile.totalCount).toBe(1)
    expect(profile.explicitCount).toBe(0)
  })

  it('clears back to the cold-start prior', () => {
    expect(emptyProfile()).toEqual({ tags: {}, families: {}, explicitCount: 0, totalCount: 0, lastSignalAt: null })
  })
})
