import { beforeEach, describe, expect, it, vi } from 'vitest'

import { launchApp } from '@/apps/launch'
import { STORE_CATALOG } from '@/apps/store/catalog'
import { installApp, registerBuiltinApps, resetAppStore } from '@/store/app-store'

import { GAME_APP_IDS, openRandomGame, pickGameId } from './game-rotation'

vi.mock('@/apps/launch', () => ({ launchApp: vi.fn() }))

const launchMock = vi.mocked(launchApp)

const GAME_MANIFESTS = STORE_CATALOG.filter((entry) =>
  GAME_APP_IDS.includes(entry.manifest.id),
)

describe('pickGameId', () => {
  const ids = ['a', 'b', 'c']

  it('excludes the last opened game when alternatives exist', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(pickGameId(ids, 'a', () => 0.99)).not.toBe('a')
      expect(pickGameId(ids, 'b', () => 0)).not.toBe('b')
    }
  })

  it('returns the sole candidate even if it was the last one', () => {
    expect(pickGameId(['only'], 'only', () => 0)).toBe('only')
  })

  it('returns null for an empty pool', () => {
    expect(pickGameId([], null)).toBeNull()
  })

  it('maps the rng range onto the reduced pool', () => {
    // 排除 a 后池 = [b, c]；rng=0 → b，rng≈1 → c。
    expect(pickGameId(ids, 'a', () => 0)).toBe('b')
    expect(pickGameId(ids, 'a', () => 0.999)).toBe('c')
  })
})

describe('openRandomGame', () => {
  beforeEach(() => {
    launchMock.mockClear()
    resetAppStore()
    registerBuiltinApps()
    localStorage.removeItem('agehaos.game.rotation.v1')
  })

  it('skips silently when no games are installed', () => {
    expect(openRandomGame()).toBeNull()
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('opens an installed game and records it as the last one', () => {
    GAME_MANIFESTS.forEach(({ manifest }) => installApp(manifest))

    const opened = openRandomGame()

    expect(GAME_APP_IDS).toContain(opened)
    expect(localStorage.getItem('agehaos.game.rotation.v1')).toBe(opened)
    expect(launchMock).toHaveBeenCalledWith(
      opened,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    )
  })

  it('never repeats the previous game while alternatives are installed', () => {
    GAME_MANIFESTS.forEach(({ manifest }) => installApp(manifest))

    const first = openRandomGame()
    launchMock.mockClear()
    const second = openRandomGame()

    expect(second).not.toBe(first)
  })
})
