import { beforeEach, describe, expect, it } from 'vitest'

import { resetMobileSheetStore, useMobileSheetStore } from './mobile-sheet-store'

/**
 * 移动状态栏两张 sheet 开合 store 契约（F1/F2）：开合从组件本地 state 提升
 * 到 store 的唯一目的 = MobileAppHost 能把它纳入 history 分层栈；语义与
 * mobile-launcher-store 同口径（等值跳过，零多余通知；两张开合互相独立）。
 */

beforeEach(() => {
  resetMobileSheetStore()
})

describe('mobile-sheet-store（通知中心/控制中心开合）', () => {
  it('starts closed', () => {
    expect(useMobileSheetStore.getState().notificationsOpen).toBe(false)
    expect(useMobileSheetStore.getState().controlCenterOpen).toBe(false)
  })

  it('open/close 各自独立：互不串台', () => {
    useMobileSheetStore.getState().openNotifications()
    expect(useMobileSheetStore.getState().notificationsOpen).toBe(true)
    expect(useMobileSheetStore.getState().controlCenterOpen).toBe(false)

    useMobileSheetStore.getState().openControlCenter()
    expect(useMobileSheetStore.getState().notificationsOpen).toBe(true)
    expect(useMobileSheetStore.getState().controlCenterOpen).toBe(true)

    useMobileSheetStore.getState().closeNotifications()
    expect(useMobileSheetStore.getState().notificationsOpen).toBe(false)
    expect(useMobileSheetStore.getState().controlCenterOpen).toBe(true)
  })

  it('重复 open/close 等值跳过：零通知（值语义）', () => {
    let notifications = 0
    const unsubscribe = useMobileSheetStore.subscribe(() => {
      notifications += 1
    })

    useMobileSheetStore.getState().openNotifications()
    expect(notifications).toBe(1)
    useMobileSheetStore.getState().openNotifications()
    expect(notifications).toBe(1)

    useMobileSheetStore.getState().closeNotifications()
    expect(notifications).toBe(2)
    useMobileSheetStore.getState().closeNotifications()
    expect(notifications).toBe(2)
    unsubscribe()
  })

  it('reset 回到双关闭态（测试隔离出口）', () => {
    useMobileSheetStore.getState().openNotifications()
    useMobileSheetStore.getState().openControlCenter()
    resetMobileSheetStore()
    expect(useMobileSheetStore.getState().notificationsOpen).toBe(false)
    expect(useMobileSheetStore.getState().controlCenterOpen).toBe(false)
  })
})
