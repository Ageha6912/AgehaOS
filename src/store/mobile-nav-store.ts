import { create } from 'zustand'

/**
 * 移动导航状态机（M0-3 Mobile Root / M1-6 AppHost 扩展状态形状 / M3-2
 * 最近任务扩展）：MobileShell 的纯前端导航状态——`{ view: 'home' }`
 * （Home/Dock 层）与 `{ view: 'app'; appId; windowId }`（应用全屏视图）
 * 二选一，外加已开应用记录 `apps`（M3-2 最近任务的数据源）。
 *
 * 单一职责不变：仍是 Shell 层「当前显示哪个视图」的单一事实来源。M1-6 起
 * 应用视图的身份扩展为 (appId, windowId)——windowId 是 MobileAppHost 真实
 * `launchApp` 的返回值（null = 尚未落地，启动中的过渡帧）；本 store 依旧
 * **不调 launchApp、不关窗口**（真实启动/关闭/生命周期绑定由
 * src/mobile/app/MobileAppHost.tsx 执行，权限门禁语义不变，PRD §24.2）。
 *
 * M3-2 最近任务（全屏单实例范式，HANDOFF §4.0）：
 * - **窗口与视图解耦**：backToHome / 切换视图不再意味着关窗——窗口存活期
 *   由 `apps` 记录承载（打开过的每个 app 一条 `{appId, windowId,
 *   openedAt}`），壳层随时可经 `switchToApp` 指回已有 windowId（AppHost
 *   见 windowId 非空即不重新 launchApp）；关窗动作（closeApp/closeAllApps）
 *   只做纯状态移除，window-store 关窗由 AppHost 的订阅统一执行
 *   （app.stopped 派生保持正确）。
 * - **单实例**：一个 appId 至多一条活记录——`openApp` 命中活记录时语义是
 *   切回（windowId 指向已有窗口，不重开）；`setAppWindow` upsert 时替换
 *   同 appId 旧记录。M1-6「从 Home 再进同一应用 = 新 windowId」的旧语义
 *   随窗口常驻一并退役（旧语义依赖「离开视图即关窗」，多窗并存会漂移成
 *   重复卡片）。
 * - 打开顺序 = apps 数组序（旧→新）；卡片呈现序（新→旧）由 UI 反转，本
 *   store 不做展示排序。
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

/** 已开应用记录（M3-2 最近任务）：windowId = launchApp 真实返回值，
 * openedAt = 记录落地时刻（AppHost setAppWindow 瞬间，卡片显示「打开时间」）。 */
export interface MobileAppRecord {
  appId: string
  windowId: string
  openedAt: number
}

interface MobileNavState {
  nav: MobileNavLocation
  /** 已开应用记录（打开序，旧→新）：窗口常驻的数据面，最近任务卡片的来源。 */
  apps: MobileAppRecord[]
  /** 打开应用：命中活记录 = 切回已有窗口（单实例）；否则进入启动过渡帧
   * （windowId null，AppHost 真实 launchApp）。 */
  openApp: (appId: string) => void
  /** 记录 AppHost 真实 launchApp 返回的窗口实例（仅 app 视图内生效），
   * M3-2 起同时 upsert 进 apps 记录（同 appId 旧记录替换，保持单实例）。 */
  setAppWindow: (windowId: string) => void
  /** 切回已开应用（M3-2）：nav 指向记录中的已有 windowId，不重新 launch；
   * 记录不存在（窗口已被关掉）为 no-op。 */
  switchToApp: (windowId: string) => void
  /** 关闭单个已开应用（M3-2 最近任务卡片动作）：移除记录；若移除的是
   * 宿主位记录，nav 回 home。window-store 关窗由 AppHost 订阅执行。 */
  closeApp: (windowId: string) => void
  /** 关闭全部已开应用（M3-2「全部关闭」）：清空记录 + nav 回 home。 */
  closeAllApps: () => void
  backToHome: () => void
}

export const useMobileNavStore = create<MobileNavState>()((set) => ({
  nav: { view: 'home' },
  apps: [],
  openApp: (appId) =>
    set((state) => {
      if (state.nav.view === 'app' && state.nav.appId === appId) return state
      // M3-2 单实例：该应用已有活窗口 → 直接切回（AppHost 不重新 launch）。
      const existing = state.apps.find((app) => app.appId === appId)
      if (existing) return { nav: { view: 'app', appId, windowId: existing.windowId } }
      return { nav: { view: 'app', appId, windowId: null } }
    }),
  setAppWindow: (windowId) =>
    set((state) => {
      if (state.nav.view !== 'app' || state.nav.windowId === windowId) return state
      // 回调里不保留联合收窄，提前取出appId。
      const appId = state.nav.appId
      return {
        nav: { view: 'app', appId, windowId },
        apps: [
          ...state.apps.filter(
            (app) => app.windowId !== windowId && app.appId !== appId,
          ),
          { appId, windowId, openedAt: Date.now() },
        ],
      }
    }),
  switchToApp: (windowId) =>
    set((state) => {
      const record = state.apps.find((app) => app.windowId === windowId)
      if (!record) return state
      if (state.nav.view === 'app' && state.nav.windowId === windowId) return state
      return { nav: { view: 'app', appId: record.appId, windowId } }
    }),
  closeApp: (windowId) =>
    set((state) => {
      const apps = state.apps.filter((app) => app.windowId !== windowId)
      if (apps.length === state.apps.length) return state
      return {
        apps,
        nav:
          state.nav.view === 'app' && state.nav.windowId === windowId
            ? { view: 'home' }
            : state.nav,
      }
    }),
  closeAllApps: () =>
    set((state) => {
      // 空列表但 nav 停在 app 视图（launchApp 过渡帧 windowId===null）也要
      // 回 home——「全部关闭」不再空转（C1 审查）。
      if (state.apps.length === 0) {
        return state.nav.view === 'app' ? { apps: [], nav: { view: 'home' } } : state
      }
      return {
        apps: [],
        nav: state.nav.view === 'app' ? { view: 'home' } : state.nav,
      }
    }),
  backToHome: () => set((state) => (state.nav.view === 'home' ? state : { nav: { view: 'home' } })),
}))

/** 测试隔离出口：回到初始 home 位置 + 空记录。 */
export function resetMobileNavStore(): void {
  useMobileNavStore.setState({ nav: { view: 'home' }, apps: [] })
}
