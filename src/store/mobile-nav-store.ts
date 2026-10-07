import { create } from 'zustand'

/**
 * 移动导航状态机（M0-3 Mobile Root）：MobileShell 的纯前端导航状态——
 * `{ view: 'home' }`（Home/Dock 层）与 `{ view: 'app'; appId }`（应用
 * 全屏视图）二选一。刻意只做纯状态机：**不调 launchApp、不碰窗口管理器**
 * （应用的真实启动/权限门禁/生命周期归 M1-6 MobileAppHost，本 store 只是
 * Shell 层「当前显示哪个视图」的单一事实来源）。
 *
 * 值语义：位置相同时跳过 setState（引用不变的 updater 返回值让 zustand
   整体跳过通知），重复 openApp/backToHome 不产生空渲染——与 device-store
   的快照等值跳过同口径。
 */

/** 导航位置并集：home = Home 层；app = 全屏应用视图（appId 必附）。 */
export type MobileNavLocation = { view: 'home' } | { view: 'app'; appId: string }

interface MobileNavState {
  nav: MobileNavLocation
  openApp: (appId: string) => void
  backToHome: () => void
}

export const useMobileNavStore = create<MobileNavState>()((set) => ({
  nav: { view: 'home' },
  openApp: (appId) =>
    set((state) =>
      state.nav.view === 'app' && state.nav.appId === appId
        ? state
        : { nav: { view: 'app', appId } },
    ),
  backToHome: () => set((state) => (state.nav.view === 'home' ? state : { nav: { view: 'home' } })),
}))

/** 测试隔离出口：回到初始 home 位置。 */
export function resetMobileNavStore(): void {
  useMobileNavStore.setState({ nav: { view: 'home' } })
}
