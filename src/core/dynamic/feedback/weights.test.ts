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

  it('clamps a single signal contribution to ±6 (§10.3 会话钳制)', () => {
    const profile = applyFeedbackSignal({
      profile: emptyProfile(),
      signal: 'pin',
      targetTags: ['fluid-gradient'],
      now: NOW,
    })
    // pin 权重 +10，但标签增量钳制到 +6。
    expect(profile.tags['fluid-gradient']).toBe(6)
    expect(profile.explicitCount).toBe(1)
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
