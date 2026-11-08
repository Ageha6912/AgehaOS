import { describe, expect, it } from 'vitest'

import { EPSILON_BY_STAGE, stageForProfile } from './epsilon'
import { emptyProfile } from './weights'
import type { PreferenceProfile } from '../types'

function profileWith(partial: Partial<PreferenceProfile>): PreferenceProfile {
  return { ...emptyProfile(), ...partial }
}

const NOW = new Date('2026-09-22T10:00:00Z')

describe('epsilon ladder (§10.2，铁律 6)', () => {
  it('uses the documented epsilon values', () => {
    expect(EPSILON_BY_STAGE).toEqual({
      'cold-start': 0.5,
      exploration: 0.4,
      convergence: 0.15,
      steady: 0.1,
      pinned: 0,
    })
  })

  it('starts at cold-start for fresh profiles', () => {
    expect(stageForProfile({ profile: emptyProfile(), now: NOW })).toBe('cold-start')
  })

  it('converges on explicit signal ≥10 or total ≥30 with ≥5 style tags', () => {
    expect(
      stageForProfile({ profile: profileWith({ explicitCount: 10, totalCount: 10 }), now: NOW }),
    ).toBe('convergence')
    // 覆盖 ≥5 个标签且总信号 ≥30：已越过稳态线（≥20），应判 steady。
    expect(
      stageForProfile({
        profile: profileWith({
          totalCount: 30,
          tags: { a: 1, b: 1, c: 1, d: 1, e: 1 },
        }),
        now: NOW,
      }),
    ).toBe('steady')
    // 覆盖不足 5 个标签时不收敛
    expect(
      stageForProfile({
        profile: profileWith({ totalCount: 15, tags: { a: 1, b: 1 } }),
        now: NOW,
      }),
    ).toBe('cold-start')
  })

  it('reaches steady state after ≥20 total signals', () => {
    expect(
      stageForProfile({
        profile: profileWith({ explicitCount: 10, totalCount: 25, tags: { a: 3, b: 2 } }),
        now: NOW,
      }),
    ).toBe('steady')
  })

  it('falls back to exploration after 14 idle days and cold-start after 28', () => {
    const stale14 = profileWith({ explicitCount: 12, totalCount: 40, lastSignalAt: '2026-09-08T00:00:00Z' })
    expect(stageForProfile({ profile: stale14, now: NOW })).toBe('exploration')
    const stale28 = profileWith({ explicitCount: 12, totalCount: 40, lastSignalAt: '2026-08-20T00:00:00Z' })
    expect(stageForProfile({ profile: stale28, now: NOW })).toBe('cold-start')
  })

  it('pins epsilon to zero (铁律 1：固定期绝不覆盖)', () => {
    expect(stageForProfile({ profile: emptyProfile(), now: NOW, stageOverride: 'pinned' })).toBe('pinned')
    expect(EPSILON_BY_STAGE.pinned).toBe(0)
  })
})

describe('lastSignalAt 时间校验（B3 审查）', () => {
  it('非法时间戳按冷启动；未来时间不误判回退', () => {
    const now = new Date('2026-11-08T12:00:00.000Z')
    expect(
      stageForProfile({ profile: { ...emptyProfile(), lastSignalAt: 'not-a-date' }, now }),
    ).toBe('cold-start')
    // 未来时间（时钟回拨）→ idleDays 钳 0：不把已收敛画像打回冷启动。
    const converged = {
      ...emptyProfile(),
      explicitCount: 10,
      totalCount: 20,
      tags: { a: 8, b: 2 },
    }
    const without = stageForProfile({ profile: converged, now })
    expect(without).not.toBe('cold-start')
    const withFuture = stageForProfile({
      profile: { ...converged, lastSignalAt: '2026-11-09T12:00:00.000Z' },
      now,
    })
    expect(withFuture).toBe(without)
  })
})
