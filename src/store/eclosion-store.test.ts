import { beforeEach, describe, expect, it } from 'vitest'

import {
  ECLOSION_KEY_PREFIX,
  resetEclosionStore,
  seedEclosionForTests,
  useEclosionStore,
  type EclosionQuotaState,
  type EclosionWorldSummary,
} from './eclosion-store'

const threeTierQuota = (overrides: Partial<EclosionQuotaState> = {}): EclosionQuotaState => ({
  configured: true,
  basic: { used: 3, limit: 10 },
  today: { used: 1, limit: 30 },
  imagine: { used: 0, limit: 20 },
  resetAtIso: '2026-10-03T00:00:00.000Z',
  ...overrides,
})

const worldSummary = (worldDate = '2026-10-03'): EclosionWorldSummary => ({
  worldDate,
  headline: '本地智能体与边缘推理的清晨',
  paletteId: 'nebula-violet',
  accentHue: 212,
  degraded: false,
  signalCount: 3,
  signals: {
    titles: ['信号甲', '信号乙', '信号丙'],
    sourceName: 'GitHub Trending',
    sourceUrl: 'https://example.invalid/feed',
  },
  apps: [
    {
      slug: 'edge-oracle',
      name: '边缘神谕',
      hue: 268,
      tagline: '一句话',
      category: 'tools',
      window: { width: 720, height: 480 },
    },
  ],
})

beforeEach(() => {
  localStorage.clear()
  resetEclosionStore()
})

describe('eclosion-store（开关/生成状态/额度）', () => {
  it('defaults to disabled (§11 待决 4 默认裁决)', () => {
    const { enabled, userId, quota, statuses, world, themeFollow } = useEclosionStore.getState()
    expect(enabled).toBe(false)
    expect(userId).toBeNull()
    expect(quota).toBeNull()
    expect(statuses).toEqual({})
    expect(world).toBeNull()
    // 「主题跟随今日世界」默认开（§6.3）。
    expect(themeFollow).toBe(true)
  })

  it('persist the toggle under a per-user key and reloads it on hydrate', () => {
    seedEclosionForTests('u-1', false)
    useEclosionStore.getState().setEnabled(true)
    expect(localStorage.getItem(`${ECLOSION_KEY_PREFIX}u-1`)).toBe(
      '{"enabled":true,"modes":{},"themeFollow":true}',
    )

    // 同设备再登录（登出不清偏好，§8）：hydrate 恢复。
    useEclosionStore.getState().handleLogout()
    useEclosionStore.getState().hydrateForUser('u-1')
    expect(useEclosionStore.getState().enabled).toBe(true)

    // 另一用户互不可见。
    useEclosionStore.getState().hydrateForUser('u-2')
    expect(useEclosionStore.getState().enabled).toBe(false)
  })

  it('keeps prefs of other users intact when clearing for tests (resetEclosionStore)', () => {
    seedEclosionForTests('u-1', true)
    useEclosionStore.getState().setEnabled(true)
    resetEclosionStore()
    expect(localStorage.getItem(`${ECLOSION_KEY_PREFIX}u-1`)).toBeNull()
    expect(useEclosionStore.getState().enabled).toBe(false)
  })

  it('logout clears session-scoped state but not persisted prefs', () => {
    seedEclosionForTests('u-1', false)
    useEclosionStore.getState().setEnabled(true) // 写盘
    useEclosionStore.getState().applyQuota(threeTierQuota())
    useEclosionStore.getState().applyWorld(worldSummary())
    useEclosionStore.getState().setStatus('com.ageha.eclosion.calculator', { phase: 'generating' })

    useEclosionStore.getState().handleLogout()

    const state = useEclosionStore.getState()
    expect(state.userId).toBeNull()
    expect(state.enabled).toBe(false)
    expect(state.quota).toBeNull()
    expect(state.statuses).toEqual({})
    expect(state.world).toBeNull()
    expect(state.notifiedWorldDate).toBeNull()
    // 偏好仍在盘上。
    expect(localStorage.getItem(`${ECLOSION_KEY_PREFIX}u-1`)).not.toBeNull()
  })

  it('setStatus creates on first patch and merges afterwards', () => {
    useEclosionStore.getState().setStatus('com.ageha.eclosion.notes', { phase: 'generating', thinkChars: 42 })
    expect(useEclosionStore.getState().statuses['com.ageha.eclosion.notes']).toMatchObject({
      appId: 'com.ageha.eclosion.notes',
      phase: 'generating',
      thinkChars: 42,
      attempt: 1,
      fellBack: false,
    })

    useEclosionStore.getState().setStatus('com.ageha.eclosion.notes', { phase: 'error', errorCode: 'ai-upstream' })
    expect(useEclosionStore.getState().statuses['com.ageha.eclosion.notes']).toMatchObject({
      phase: 'error',
      thinkChars: 42, // 未指定的字段保留
      errorCode: 'ai-upstream',
    })
  })

  it('applyQuota stores the three-tier snapshot for Settings (basic/today/imagine)', () => {
    useEclosionStore.getState().applyQuota(
      threeTierQuota({ configured: false, basic: { used: 0, limit: 10 }, resetAtIso: null }),
    )
    expect(useEclosionStore.getState().quota).toEqual({
      configured: false,
      basic: { used: 0, limit: 10 },
      today: { used: 1, limit: 30 },
      imagine: { used: 0, limit: 20 },
      resetAtIso: null,
    })
  })

  it('defaults generate modes to eclosion and persists per-app choices', () => {
    seedEclosionForTests('u-1', true)
    // 缺省即「羽化」：modes 空表 = 三件套全羽化。
    expect(useEclosionStore.getState().modes).toEqual({})

    useEclosionStore.getState().setGenerateMode('calculator', 'classic')
    expect(useEclosionStore.getState().modes).toEqual({ calculator: 'classic' })

    // 落盘 + hydrate 恢复；另一用户互不可见。
    useEclosionStore.getState().handleLogout()
    useEclosionStore.getState().hydrateForUser('u-1')
    expect(useEclosionStore.getState().modes).toEqual({ calculator: 'classic' })
    useEclosionStore.getState().hydrateForUser('u-2')
    expect(useEclosionStore.getState().modes).toEqual({})
  })

  it('drops dirty mode entries from persisted payloads (脏数据不破坏启动)', () => {
    seedEclosionForTests('u-9', false)
    localStorage.setItem(
      `${ECLOSION_KEY_PREFIX}u-9`,
      JSON.stringify({ enabled: true, modes: { notes: 'classic', evil: 'both', calculator: 42 } }),
    )
    useEclosionStore.getState().hydrateForUser('u-9')
    expect(useEclosionStore.getState().modes).toEqual({ notes: 'classic' })
    expect(useEclosionStore.getState().enabled).toBe(true)
  })
})

describe('eclosion-store（主题跟随 / 今日世界，§6.3/§6.2）', () => {
  it('persists themeFollow per user; old payloads without the field hydrate to true', () => {
    seedEclosionForTests('u-theme', true)
    useEclosionStore.getState().setThemeFollow(false)
    expect(JSON.parse(String(localStorage.getItem(`${ECLOSION_KEY_PREFIX}u-theme`)))).toMatchObject({
      themeFollow: false,
    })

    useEclosionStore.getState().handleLogout()
    useEclosionStore.getState().hydrateForUser('u-theme')
    expect(useEclosionStore.getState().themeFollow).toBe(false)

    // 老偏好（P1 时期的两字段 JSON）无 themeFollow → 默认开。
    seedEclosionForTests('u-legacy', false)
    localStorage.setItem(
      `${ECLOSION_KEY_PREFIX}u-legacy`,
      JSON.stringify({ enabled: true, modes: {} }),
    )
    useEclosionStore.getState().hydrateForUser('u-legacy')
    expect(useEclosionStore.getState().themeFollow).toBe(true)
  })

  it('holds the validated world summary and replaces it per world day', () => {
    seedEclosionForTests('u-world', true)
    useEclosionStore.getState().applyWorld(worldSummary('2026-10-03'))
    expect(useEclosionStore.getState().world?.headline).toBe('本地智能体与边缘推理的清晨')
    expect(useEclosionStore.getState().world?.apps[0]?.slug).toBe('edge-oracle')

    // 个人重生成/跨日：同字段整体替换。
    useEclosionStore.getState().applyWorld(worldSummary('2026-10-04'))
    expect(useEclosionStore.getState().world?.worldDate).toBe('2026-10-04')

    // 世界是会话级产物：hydrate（重登录）不恢复。
    useEclosionStore.getState().hydrateForUser('u-world')
    expect(useEclosionStore.getState().world).toBeNull()
  })

  it('mirrors the kept-app list for the launcher (我的羽化)', () => {
    seedEclosionForTests('u-kept', true)
    expect(useEclosionStore.getState().keptAppIds).toEqual([])
    useEclosionStore.getState().setKeptAppIds(['com.ageha.eclosion.app-01'])
    useEclosionStore.getState().setKeptAppIds(['com.ageha.eclosion.app-01', 'com.ageha.eclosion.app-02'])
    expect(useEclosionStore.getState().keptAppIds).toEqual([
      'com.ageha.eclosion.app-01',
      'com.ageha.eclosion.app-02',
    ])
    // 会话级：登出/重登录清空（编排器恢复时重写）。
    useEclosionStore.getState().handleLogout()
    expect(useEclosionStore.getState().keptAppIds).toEqual([])
  })

  it('tracks the notified world day for one-notification-per-day dedupe', () => {
    seedEclosionForTests('u-world', true)
    expect(useEclosionStore.getState().notifiedWorldDate).toBeNull()
    useEclosionStore.getState().markWorldNotified('2026-10-03')
    expect(useEclosionStore.getState().notifiedWorldDate).toBe('2026-10-03')
    useEclosionStore.getState().markWorldNotified('2026-10-04')
    expect(useEclosionStore.getState().notifiedWorldDate).toBe('2026-10-04')
  })
})
