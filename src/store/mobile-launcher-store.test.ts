import { beforeEach, describe, expect, it } from 'vitest'

import {
  resetMobileLauncherStore,
  useMobileLauncherStore,
} from './mobile-launcher-store'

/**
 * 移动启动器开合 store 契约（M3-1）：网格搜索按钮与底缘上滑手势两个入口
 * 共享同一开合——open 等值跳过（重复 openLauncher/closeLauncher 不产生空
 * 通知，与 mobile-nav-store 同口径）。
 */

beforeEach(() => {
  resetMobileLauncherStore()
})

describe('mobile-launcher-store（启动器开合）', () => {
  it('starts closed', () => {
    expect(useMobileLauncherStore.getState().open).toBe(false)
  })

  it('openLauncher opens; closeLauncher closes', () => {
    useMobileLauncherStore.getState().openLauncher()
    expect(useMobileLauncherStore.getState().open).toBe(true)

    useMobileLauncherStore.getState().closeLauncher()
    expect(useMobileLauncherStore.getState().open).toBe(false)
  })

  it('重复 openLauncher/closeLauncher 等值跳过：零通知（值语义）', () => {
    let notifications = 0
    const unsubscribe = useMobileLauncherStore.subscribe(() => {
      notifications += 1
    })

    useMobileLauncherStore.getState().openLauncher()
    expect(notifications).toBe(1)
    useMobileLauncherStore.getState().openLauncher()
    expect(notifications).toBe(1)

    useMobileLauncherStore.getState().closeLauncher()
    expect(notifications).toBe(2)
    useMobileLauncherStore.getState().closeLauncher()
    expect(notifications).toBe(2)
    unsubscribe()
  })

  it('reset 回到关闭态（测试隔离出口）', () => {
    useMobileLauncherStore.getState().openLauncher()
    resetMobileLauncherStore()
    expect(useMobileLauncherStore.getState().open).toBe(false)
  })
})
