import { create } from 'zustand'

/**
 * 移动导航状态机（M0-3 Mobile Root / M1-6 AppHost 扩展状态形状）：MobileShell
 * 的纯前端导航状态——`{ view: 'home' }`（Home/Dock 层）与
 * `{ view: 'app'; appId; windowId }`（应用全屏视图）二选一。
 *
 * 单一职责不变：仍是 Shell 层「当前显示哪个视图」的单一事实来源。M1-6 起
 * 应用视图的身份扩展为 (appId, windowId)——windowId 是 MobileAppHost 真实
 * `launchApp` 的返回值（null = 尚未落地，启动中的过渡帧）；本 store 依旧
 * **不调 launchApp、不碰窗口管理器**（真实启动/关闭/生命周期绑定由
 * src/mobile/app/MobileAppHost.tsx 执行，权限门禁语义不变，PRD §24.2）。
 *
 * 值语义：位置相同时跳过 setState（引用不变的 updater 返回值让 zustand
   整体跳过通知），重复 openApp/backToHome/setAppWindow 不产生空渲染——与
   device-store 的快照等值跳过同口径。
 */

/** 导航位置并集：home = Home 层；app = 全屏应用视图（appId 必附；windowId
 * = 宿主窗口实例，null 表示启动尚未返回）。 */
export type MobileNavLocation =
  | { view: 'home' }
  | { view: 'app'; appId: string; windowId: string | null }

interface MobileNavState {
  nav: MobileNavLocation
  openApp: (appId: string) => void
  /** 记录 AppHost 真实 launchApp 返回的窗口实例（仅 app 视图内生效）。 */
  setAppWindow: (windowId: string) => void
  backToHome: () => void
}

export const useMobileNavStore = create<MobileNavState>()((set) => ({
  nav: { view: 'home' },
  openApp: (appId) =>
    set((state) =>
      state.nav.view === 'app' && state.nav.appId === appId
        ? state
        : { nav: { view: 'app', appId, windowId: null } },
    ),
  setAppWindow: (windowId) =>
    set((state) =>
      state.nav.view === 'app' && state.nav.windowId !== windowId
        ? { nav: { view: 'app', appId: state.nav.appId, windowId } }
        : state,
    ),
  backToHome: () => set((state) => (state.nav.view === 'home' ? state : { nav: { view: 'home' } })),
}))

/** 测试隔离出口：回到初始 home 位置。 */
export function resetMobileNavStore(): void {
  useMobileNavStore.setState({ nav: { view: 'home' } })
}
