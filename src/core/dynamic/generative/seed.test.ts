import { describe, expect, it } from 'vitest'

import {
  deriveDomainSeed,
  deriveSessionSeed,
  localDateKey,
  mulberry32,
  sha256Hex,
  timePhaseOf,
} from './seed'

describe('sha256Hex', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('handles multi-block inputs (>= 64 bytes) and UTF-8', () => {
    // sha256('The quick brown fox jumps over the lazy dog')
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    )
    // 'a'.repeat(1000) 跨 16 个分组
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    )
    expect(sha256Hex('蝶')).toBe(sha256Hex('蝶'))
    expect(sha256Hex('蝶')).not.toBe(sha256Hex('蜂'))
  })
})

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32('seed-1')
    const b = mulberry32('seed-1')
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces values in [0,1) and diverges across seeds', () => {
    const rng = mulberry32('seed-2')
    for (let i = 0; i < 100; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(mulberry32('seed-2')()).not.toBe(mulberry32('seed-3')())
  })
})

describe('localDateKey / timePhaseOf', () => {
  it('formats the local date', () => {
    expect(localDateKey(new Date(2026, 8, 22))).toBe('2026-09-22')
  })

  it('maps hours to the four phases (§2.1)', () => {
    expect(timePhaseOf(5)).toBe('morning')
    expect(timePhaseOf(10)).toBe('morning')
    expect(timePhaseOf(11)).toBe('day')
    expect(timePhaseOf(16)).toBe('day')
    expect(timePhaseOf(17)).toBe('evening')
    expect(timePhaseOf(21)).toBe('evening')
    expect(timePhaseOf(22)).toBe('night')
    expect(timePhaseOf(4)).toBe('night')
  })
})

describe('seed derivation (§6.1)', () => {
  it('is deterministic per user/date/session and per attempt/version', () => {
    const now = new Date(2026, 8, 22, 10, 30)
    const session = deriveSessionSeed('user-1', now, 1)
    expect(deriveSessionSeed('user-1', now, 1)).toBe(session)
    expect(deriveSessionSeed('user-1', now, 2)).not.toBe(session)
    expect(deriveSessionSeed('user-2', now, 1)).not.toBe(session)

    const domain = deriveDomainSeed(session, 'wallpaper', 1, 3)
    expect(deriveDomainSeed(session, 'wallpaper', 1, 3)).toBe(domain)
    expect(deriveDomainSeed(session, 'wallpaper', 2, 3)).not.toBe(domain)
    expect(deriveDomainSeed(session, 'wallpaper', 1, 4)).not.toBe(domain)
    expect(deriveDomainSeed(session, 'theme', 1, 3)).not.toBe(domain)
  })
})
