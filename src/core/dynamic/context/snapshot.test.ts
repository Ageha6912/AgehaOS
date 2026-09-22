import { beforeEach, describe, expect, it } from 'vitest'

import { buildContextSnapshot, resetContextVersion } from './snapshot'

beforeEach(() => {
  resetContextVersion()
})

describe('context snapshot (§2.2)', () => {
  it('freezes whitelist signals with the correct phase and season', () => {
    const snapshot = buildContextSnapshot({
      now: new Date(2026, 8, 22, 19, 30),
      theme: 'dark',
      tier: 'mid',
    })
    expect(snapshot.timePhase).toBe('evening')
    expect(snapshot.season).toBe('autumn')
    expect(snapshot.theme).toBe('dark')
    expect(snapshot.tier).toBe('mid')
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it('derives the tier from injected signals (验收 ⑤)', () => {
    const snapshot = buildContextSnapshot({
      now: new Date(2026, 8, 22, 10, 0),
      theme: 'dark',
      tierSignals: { hardwareConcurrency: 8, deviceMemory: 8, hasWebGL2: true },
    })
    expect(snapshot.tier).toBe('high')
  })

  it('keeps contextVersion monotonically increasing per session', () => {
    const first = buildContextSnapshot({ now: new Date(), theme: 'dark', tier: 'low' })
    const second = buildContextSnapshot({ now: new Date(), theme: 'dark', tier: 'low' })
    expect(second.contextVersion).toBe(first.contextVersion + 1)
    resetContextVersion()
    expect(buildContextSnapshot({ now: new Date(), theme: 'dark', tier: 'low' }).contextVersion).toBe(1)
  })
})
