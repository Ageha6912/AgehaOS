import { beforeEach, describe, expect, it } from 'vitest'

import { resetMobileNavStore } from './mobile-nav-store'
import { resetMobileRecentsStore, useMobileRecentsStore } from './mobile-recents-store'

beforeEach(() => {
  resetMobileNavStore()
  resetMobileRecentsStore()
})

describe('mobile-recents-store（最近任务开合，M3-2）', () => {
  it('starts closed', () => {
    expect(useMobileRecentsStore.getState().open).toBe(false)
  })

  it('openRecents opens once; repeated open is a no-op (idempotent)', () => {
    useMobileRecentsStore.getState().openRecents()
    expect(useMobileRecentsStore.getState().open).toBe(true)

    useMobileRecentsStore.getState().openRecents()
    expect(useMobileRecentsStore.getState().open).toBe(true)
  })

  it('closeRecents closes; closing while closed is a no-op', () => {
    useMobileRecentsStore.getState().openRecents()
    useMobileRecentsStore.getState().closeRecents()
    expect(useMobileRecentsStore.getState().open).toBe(false)

    useMobileRecentsStore.getState().closeRecents()
    expect(useMobileRecentsStore.getState().open).toBe(false)
  })
})
