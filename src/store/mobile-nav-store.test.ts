import { beforeEach, describe, expect, it } from 'vitest'

import { resetMobileNavStore, useMobileNavStore } from './mobile-nav-store'

beforeEach(() => {
  resetMobileNavStore()
})

describe('mobile-nav-store（移动导航状态机）', () => {
  it('starts at home', () => {
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('openApp switches to the app view carrying the appId', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'app', appId: 'com.ageha.notes' })
  })

  it('openApp replaces the previous app without returning home', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().openApp('com.ageha.calculator')

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'app', appId: 'com.ageha.calculator' })
  })

  it('backToHome returns from an app and carries no appId', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().backToHome()

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect('appId' in useMobileNavStore.getState().nav).toBe(false)
  })

  it('skips notifications when the location does not change', () => {
    let notifications = 0
    const unsubscribe = useMobileNavStore.subscribe(() => {
      notifications += 1
    })

    useMobileNavStore.getState().backToHome()
    expect(notifications, 'backToHome at home is a no-op').toBe(0)

    useMobileNavStore.getState().openApp('com.ageha.notes')
    expect(notifications).toBe(1)

    useMobileNavStore.getState().openApp('com.ageha.notes')
    expect(notifications, 're-opening the same app is a no-op').toBe(1)

    useMobileNavStore.getState().backToHome()
    expect(notifications).toBe(2)
    unsubscribe()
  })
})
