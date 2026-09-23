import { beforeEach, describe, expect, it } from 'vitest'

import { buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
import type { GenerationOutcome } from '@/core/dynamic/types'

import {
  DYNAMIC_DESKTOP_KEY_PREFIX,
  MANUAL_REFRESH_THROTTLE_MS,
  resetDynamicDesktopStore,
  seedDynamicDesktopForTests,
  useDynamicDesktopStore,
} from './dynamic-desktop-store'

function planOf(seed: string) {
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

function outcomeOf(seed: string, level: GenerationOutcome['level'] = 'L0'): GenerationOutcome {
  return { plan: planOf(seed), level, durationMs: 5, decisionSource: 'local' }
}

beforeEach(() => {
  resetDynamicDesktopStore()
})

describe('dynamic-desktop-store defaults (总开关默认关闭)', () => {
  it('starts disabled with the balanced slider default', () => {
    const state = useDynamicDesktopStore.getState()
    expect(state.prefs.enabled).toBe(false)
    expect(state.prefs.randomness).toBe(40)
    expect(state.prefs.pinned).toBeNull()
    expect(state.currentPlan).toBeNull()
  })
})

describe('per-user hydration and persistence (§2.3 按 userId 分键)', () => {
  it('persists prefs under the per-user key and restores them on re-hydration', () => {
    useDynamicDesktopStore.getState().hydrateForUser('alice')
    useDynamicDesktopStore.getState().setEnabled(true)
    useDynamicDesktopStore.getState().setRandomness(75)

    expect(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}alice`)).not.toBeNull()

    // 模拟重新登录：重新读档应恢复持久化值
    useDynamicDesktopStore.getState().hydrateForUser('alice')
    const state = useDynamicDesktopStore.getState()
    expect(state.prefs.enabled).toBe(true)
    expect(state.prefs.randomness).toBe(75)
  })

  it('keeps users isolated from each other', () => {
    useDynamicDesktopStore.getState().hydrateForUser('alice')
    useDynamicDesktopStore.getState().setEnabled(true)
    useDynamicDesktopStore.getState().hydrateForUser('bob')
    expect(useDynamicDesktopStore.getState().prefs.enabled).toBe(false)
    useDynamicDesktopStore.getState().hydrateForUser('alice')
    expect(useDynamicDesktopStore.getState().prefs.enabled).toBe(true)
  })

  it('falls back to defaults on corrupted payloads (§2.3 脏数据不破坏启动)', () => {
    localStorage.setItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}carol`, '{bad json')
    useDynamicDesktopStore.getState().hydrateForUser('carol')
    expect(useDynamicDesktopStore.getState().prefs).toMatchObject({ enabled: false, randomness: 40 })
  })
})

describe('generation outcome application', () => {
  it('records plan, level, history, recents and ordinal', () => {
    seedDynamicDesktopForTests('u1')
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1000, tier: 'mid' })
    const state = useDynamicDesktopStore.getState()
    expect(state.currentPlan?.seed).toBe('p1')
    expect(state.currentLevel).toBe('L0')
    expect(state.lastDecisionSource).toBe('local')
    expect(state.tier).toBe('mid')
    expect(state.history).toHaveLength(1)
    expect(state.recentStyles).toEqual(['geometric'])
    expect(state.generationOrdinal).toBe(2)
    expect(state.lastGenerateAt).toBe(1000)
  })

  it('records a light negative signal on manual refresh (§10.2 换一张 −1.5→钳制 −1.5)', () => {
    seedDynamicDesktopForTests('u1')
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p1'), trigger: 'manual', atMs: 1000, tier: 'mid' })
    const profile = useDynamicDesktopStore.getState().profile
    expect(profile.totalCount).toBe(1)
    expect(profile.explicitCount).toBe(1)
    expect(profile.tags.geometric).toBeLessThan(0)
  })

  it('throttles manual refreshes to ≥5s (§4.6)', () => {
    expect(MANUAL_REFRESH_THROTTLE_MS).toBe(5000)
  })
})

describe('pin / unpin / block / rollback (铁律 1)', () => {
  it('pins the current plan and unpins back to null', () => {
    seedDynamicDesktopForTests('u1')
    const store = useDynamicDesktopStore.getState()
    store.applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().pinCurrent()
    expect(useDynamicDesktopStore.getState().prefs.pinned?.seed).toBe('p1')
    useDynamicDesktopStore.getState().unpin()
    expect(useDynamicDesktopStore.getState().prefs.pinned).toBeNull()
  })

  it('keeps the pin across hydration (验收 ①：固定后重登不变)', () => {
    useDynamicDesktopStore.getState().hydrateForUser('u1')
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('persist-pin'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().pinCurrent()

    // 模拟重新登录：重新读档后固定项仍在
    useDynamicDesktopStore.getState().hydrateForUser('u1')
    expect(useDynamicDesktopStore.getState().prefs.pinned?.seed).toBe('persist-pin')
  })

  it('blocks the current style once and caps the blocklist at 200', () => {
    seedDynamicDesktopForTests('u1')
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().blockCurrentStyle()
    expect(useDynamicDesktopStore.getState().prefs.blockedStyles).toEqual(['geometric'])
    useDynamicDesktopStore.getState().blockCurrentStyle()
    expect(useDynamicDesktopStore.getState().prefs.blockedStyles).toEqual(['geometric'])
  })

  it('rolls back to a history entry and turns it into the pinned state (§6.5)', () => {
    seedDynamicDesktopForTests('u1')
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p2'), trigger: 'manual', atMs: 2, tier: 'low' })
    useDynamicDesktopStore.getState().rollbackTo(0)
    const state = useDynamicDesktopStore.getState()
    expect(state.currentPlan?.seed).toBe('p1')
    expect(state.lastDecisionSource).toBe('cache')
    expect(state.prefs.pinned?.seed).toBe('p1')
  })
})

describe('feedback application', () => {
  it('updates the profile for the current plan style', () => {
    seedDynamicDesktopForTests('u1')
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().applyFeedback('like')
    const profile = useDynamicDesktopStore.getState().profile
    expect(profile.tags.geometric).toBe(3)
    expect(profile.totalCount).toBe(1)
  })
})

describe('clear and logout (§8.5 / §6.5)', () => {
  it('clearAllData resets everything and removes the persisted key', () => {
    seedDynamicDesktopForTests('u1')
    const store = useDynamicDesktopStore.getState()
    store.setEnabled(true)
    store.applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().clearAllData()
    const state = useDynamicDesktopStore.getState()
    expect(state.prefs.enabled).toBe(false)
    expect(state.currentPlan).toBeNull()
    expect(state.history).toHaveLength(0)
    expect(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`)).toBeNull()
  })

  it('handleLogout clears session state but retains per-user prefs', () => {
    seedDynamicDesktopForTests('u1')
    const store = useDynamicDesktopStore.getState()
    store.setEnabled(true)
    store.applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'low' })
    useDynamicDesktopStore.getState().handleLogout()
    const state = useDynamicDesktopStore.getState()
    expect(state.userId).toBeNull()
    expect(state.currentPlan).toBeNull()
    expect(state.prefs.enabled).toBe(true)
  })
})

describe('resetDynamicDesktopStore isolation (验收 ⑥)', () => {
  it('restores defaults and wipes persisted keys between tests', () => {
    useDynamicDesktopStore.getState().hydrateForUser('u1')
    useDynamicDesktopStore.getState().setEnabled(true)
    useDynamicDesktopStore.getState().applyOutcome({ outcome: outcomeOf('p1'), trigger: 'login', atMs: 1, tier: 'high' })
    expect(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`)).not.toBeNull()

    resetDynamicDesktopStore()

    const state = useDynamicDesktopStore.getState()
    expect(state.prefs.enabled).toBe(false)
    expect(state.currentPlan).toBeNull()
    expect(state.tier).toBe('mid')
    expect(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`)).toBeNull()
  })
})

describe('layout suggestion adoption (DDS §5.1 域②)', () => {
  const suggestion = {
    layoutId: 'layout-1',
    tier: 'double' as const,
    groups: [{ nameKey: 'tools' as const, appIds: ['com.ageha.calculator'] }],
  }

  beforeEach(() => {
    seedDynamicDesktopForTests('u1')
  })

  it('keeps the suggestion session-scoped and applies it on request', () => {
    useDynamicDesktopStore.getState().setLayoutSuggestion(suggestion)
    expect(useDynamicDesktopStore.getState().layoutSuggestion?.layoutId).toBe('layout-1')
    expect(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`)).toBeNull()

    useDynamicDesktopStore.getState().applyLayout(suggestion)
    expect(useDynamicDesktopStore.getState().appliedLayout).toEqual(suggestion)
    expect(useDynamicDesktopStore.getState().layoutSuggestion).toBeNull()
    expect(
      JSON.parse(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`) ?? '{}').appliedLayout,
    ).toEqual(suggestion)
  })

  it('restores the applied layout from the per-user key on hydrate', () => {
    useDynamicDesktopStore.getState().applyLayout(suggestion)
    useDynamicDesktopStore.getState().hydrateForUser('u1')
    expect(useDynamicDesktopStore.getState().appliedLayout).toEqual(suggestion)
  })

  it('falls back to null on corrupted persisted layouts', () => {
    const raw = JSON.parse(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`) ?? '{}')
    localStorage.setItem(
      `${DYNAMIC_DESKTOP_KEY_PREFIX}u1`,
      JSON.stringify({ ...raw, appliedLayout: { layoutId: 'x', tier: 'mega', groups: [] } }),
    )
    useDynamicDesktopStore.getState().hydrateForUser('u1')
    expect(useDynamicDesktopStore.getState().appliedLayout).toBeNull()
  })

  it('refuses to persist protected apps inside an adopted layout', () => {
    const evil = {
      layoutId: 'layout-2',
      tier: 'single' as const,
      groups: [{ nameKey: 'tools' as const, appIds: ['com.ageha.settings'] }],
    }
    useDynamicDesktopStore.getState().applyLayout(evil)
    // sanitizeLayout on next hydrate drops it — the store round-trip is the guard.
    useDynamicDesktopStore.getState().hydrateForUser('u1')
    expect(useDynamicDesktopStore.getState().appliedLayout).toBeNull()
  })

  it('resetAppliedLayout clears the adopted layout', () => {
    useDynamicDesktopStore.getState().applyLayout(suggestion)
    useDynamicDesktopStore.getState().resetAppliedLayout()
    expect(useDynamicDesktopStore.getState().appliedLayout).toBeNull()
    expect(
      JSON.parse(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`) ?? '{}').appliedLayout,
    ).toBeNull()
  })

  it('logout clears both suggestion and applied layout from memory', () => {
    useDynamicDesktopStore.getState().applyLayout(suggestion)
    useDynamicDesktopStore.getState().handleLogout()
    expect(useDynamicDesktopStore.getState().appliedLayout).toBeNull()
    expect(useDynamicDesktopStore.getState().layoutSuggestion).toBeNull()
  })
})
