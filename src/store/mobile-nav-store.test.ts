import { beforeEach, describe, expect, it } from 'vitest'

import { resetMobileNavStore, useMobileNavStore } from './mobile-nav-store'

beforeEach(() => {
  resetMobileNavStore()
})

describe('mobile-nav-store（移动导航状态机）', () => {
  it('starts at home', () => {
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('openApp switches to the app view carrying the appId (windowId pending)', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: null,
    })
  })

  it('openApp replaces the previous app without returning home (windowId resets)', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-notes')
    useMobileNavStore.getState().openApp('com.ageha.calculator')

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.calculator',
      windowId: null,
    })
  })

  it('setAppWindow records the launched window instance in the app view (M1-6)', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-1')

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'win-1',
    })
  })

  it('setAppWindow is a no-op outside the app view（home 不收窗口记录）', () => {
    let notifications = 0
    const unsubscribe = useMobileNavStore.subscribe(() => {
      notifications += 1
    })

    useMobileNavStore.getState().setAppWindow('win-1')
    expect(notifications).toBe(0)
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    unsubscribe()
  })

  it('backToHome returns from an app and carries no appId/windowId', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-1')
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

    // 同视图重复 openApp 同一 appId：no-op（宿主窗口不换、不重复启动）。
    useMobileNavStore.getState().setAppWindow('win-1')
    expect(notifications).toBe(2)
    useMobileNavStore.getState().openApp('com.ageha.notes')
    expect(notifications, 're-opening the same app is a no-op').toBe(2)
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'win-1',
    })

    // setAppWindow 写入相同 windowId：no-op。
    useMobileNavStore.getState().setAppWindow('win-1')
    expect(notifications).toBe(2)

    useMobileNavStore.getState().backToHome()
    expect(notifications).toBe(3)
    unsubscribe()
  })
})
