import { create } from 'zustand'

/**
 * 移动状态栏两张 Bottom Sheet 的开合状态（M2-2 通知中心 / M2-3 控制中心）。
 *
 * 开合从 MobileStatusBar 的组件本地 state 提升到 store 的唯一原因：覆盖层
 * 必须进入 MobileAppHost 的 history 分层栈（F1/F2 审查：app 视图下打开 sheet
 * 再按 Android 返回键，应用退回 Home 而 sheet 仍盖着；Home 下打开 sheet 按返
 * 回键则直接离开 AgehaOS）。history 的唯一消费者是 MobileAppHost，它按
 * store 布尔同步栈位并在 popstate 时经本 store 关闭覆盖层——组件本地 state
 * 对 AppHost 不可达。
 *
 * 只放开合，不放 sheet 内部相位（closed/open/leaving 仍是组件本地相位机，
 * 与 mobile-launcher-store / mobile-recents-store 同一分工）。开关动作幂等；
 * 两张 sheet 的全屏 backdrop 天然互斥（一个打开时另一个入口不可点），本
 * store 不额外建互斥状态机。
 */
interface MobileSheetState {
  notificationsOpen: boolean
  controlCenterOpen: boolean
  openNotifications: () => void
  closeNotifications: () => void
  openControlCenter: () => void
  closeControlCenter: () => void
}

export const useMobileSheetStore = create<MobileSheetState>()((set) => ({
  notificationsOpen: false,
  controlCenterOpen: false,
  openNotifications: () =>
    set((state) => (state.notificationsOpen ? state : { notificationsOpen: true })),
  closeNotifications: () =>
    set((state) => (state.notificationsOpen ? { notificationsOpen: false } : state)),
  openControlCenter: () =>
    set((state) => (state.controlCenterOpen ? state : { controlCenterOpen: true })),
  closeControlCenter: () =>
    set((state) => (state.controlCenterOpen ? { controlCenterOpen: false } : state)),
}))

/** 测试隔离出口：回到初始关闭态。 */
export function resetMobileSheetStore(): void {
  useMobileSheetStore.setState({ notificationsOpen: false, controlCenterOpen: false })
}
