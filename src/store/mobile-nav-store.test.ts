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

/**
 * M3-2 最近任务扩展：apps 记录（appId+windowId+openedAt，单实例）+
 * switchToApp / closeApp / closeAllApps 纯状态；窗口常驻后 backToHome
 * 不再携带「关窗」语义（关窗执行方 = MobileAppHost 的记录订阅）。
 */
describe('mobile-nav-store 最近任务（M3-2）', () => {
  it('setAppWindow 落地即写入记录（appId/windowId/openedAt），同 appId 旧记录被 upsert 替换（单实例）', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-1')

    const apps = useMobileNavStore.getState().apps
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ appId: 'com.ageha.notes', windowId: 'win-1' })
    expect(apps[0]?.openedAt).toBeTypeOf('number')

    // 同 appId 换新窗（理论路径：记录被哨兵剪掉后再启动）：不产生重复卡。
    useMobileNavStore.getState().setAppWindow('win-2')
    expect(useMobileNavStore.getState().apps).toEqual([
      { appId: 'com.ageha.notes', windowId: 'win-2', openedAt: expect.any(Number) },
    ])
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'win-2',
    })
  })

  it('openApp 命中活记录 = 切回已有 windowId（不重新启动，单实例）；记录不在 = 启动过渡帧', () => {
    useMobileNavStore.getState().openApp('com.ageha.files')
    useMobileNavStore.getState().setAppWindow('win-files')
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-notes')

    // Home 再进 Files：指向已有窗口（AppHost 见 windowId 非空不 launch）。
    useMobileNavStore.getState().backToHome()
    useMobileNavStore.getState().openApp('com.ageha.files')
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.files',
      windowId: 'win-files',
    })

    // 未开过的应用仍是启动过渡帧（windowId null → AppHost launchApp）。
    useMobileNavStore.getState().openApp('com.ageha.calculator')
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.calculator',
      windowId: null,
    })
  })

  it('switchToApp：nav 指向记录中的已有窗口；未知 windowId 与当前窗口 no-op（等值跳过）', () => {
    let notifications = 0
    const unsubscribe = useMobileNavStore.subscribe(() => {
      notifications += 1
    })

    useMobileNavStore.getState().setAppWindow('win-x') // home 档 no-op
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })

    useMobileNavStore.getState().openApp('com.ageha.files')
    useMobileNavStore.getState().setAppWindow('win-files')
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-notes')
    const afterTwo = notifications

    // 未知 windowId：no-op（窗口已被关光的记录不该切出僵尸视图）。
    useMobileNavStore.getState().switchToApp('win-ghost')
    expect(notifications).toBe(afterTwo)
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'win-notes',
    })

    // 切回 Files：纯指针移动，记录不动、launch 不发生。
    useMobileNavStore.getState().switchToApp('win-files')
    expect(notifications).toBe(afterTwo + 1)
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.files',
      windowId: 'win-files',
    })
    expect(useMobileNavStore.getState().apps.map((app) => app.windowId)).toEqual([
      'win-files',
      'win-notes',
    ])

    // 当前窗口重复 switchToApp：等值跳过。
    useMobileNavStore.getState().switchToApp('win-files')
    expect(notifications).toBe(afterTwo + 1)
    unsubscribe()
  })

  it('closeApp：移除记录；宿主位记录被关 → nav 回 home；非宿主 → nav 不动；未知 → no-op', () => {
    useMobileNavStore.getState().openApp('com.ageha.files')
    useMobileNavStore.getState().setAppWindow('win-files')
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-notes')

    // 未知 windowId：no-op。
    useMobileNavStore.getState().closeApp('win-ghost')
    expect(useMobileNavStore.getState().apps).toHaveLength(2)

    // 非宿主记录（后台窗）：记录消失，视图仍在 Notes。
    useMobileNavStore.getState().closeApp('win-files')
    expect(useMobileNavStore.getState().apps.map((app) => app.windowId)).toEqual(['win-notes'])
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'win-notes',
    })

    // 宿主记录：nav 回 home。
    useMobileNavStore.getState().closeApp('win-notes')
    expect(useMobileNavStore.getState().apps).toEqual([])
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('closeAllApps：清空记录 + app 档回 home；空记录幂等（零通知）', () => {
    let notifications = 0
    const unsubscribe = useMobileNavStore.subscribe(() => {
      notifications += 1
    })

    // 空记录：no-op。
    useMobileNavStore.getState().closeAllApps()
    expect(notifications).toBe(0)

    useMobileNavStore.getState().openApp('com.ageha.files')
    useMobileNavStore.getState().setAppWindow('win-files')
    const before = notifications

    useMobileNavStore.getState().closeAllApps()
    expect(notifications).toBe(before + 1)
    expect(useMobileNavStore.getState().apps).toEqual([])
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })

    unsubscribe()
  })

  it('closeAllApps：多记录全清，app 档回 home，home 档位置保持', () => {
    useMobileNavStore.getState().openApp('com.ageha.files')
    useMobileNavStore.getState().setAppWindow('win-files')
    useMobileNavStore.getState().openApp('com.ageha.notes')
    useMobileNavStore.getState().setAppWindow('win-notes')

    useMobileNavStore.getState().closeAllApps()
    expect(useMobileNavStore.getState().apps).toEqual([])
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })

    // home 档再全关：位置保持 home。
    useMobileNavStore.getState().closeAllApps()
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('backToHome 不再关记录（窗口常驻）：apps 原样，重进 = 切回', () => {
    useMobileNavStore.getState().openApp('com.ageha.files')
    useMobileNavStore.getState().setAppWindow('win-files')

    useMobileNavStore.getState().backToHome()
    expect(useMobileNavStore.getState().apps).toEqual([
      { appId: 'com.ageha.files', windowId: 'win-files', openedAt: expect.any(Number) },
    ])

    useMobileNavStore.getState().openApp('com.ageha.files')
    const nav = useMobileNavStore.getState().nav
    expect(nav).toEqual({ view: 'app', appId: 'com.ageha.files', windowId: 'win-files' })
  })
})

describe('closeAllApps 空列表（C1 审查）', () => {
  it('apps 为空但 nav 停在 app 视图（过渡帧）也回 home', () => {
    useMobileNavStore.setState({ apps: [], nav: { view: 'app', appId: 'com.ageha.notes', windowId: null } })
    useMobileNavStore.getState().closeAllApps()
    expect(useMobileNavStore.getState().nav.view).toBe('home')
  })
})
