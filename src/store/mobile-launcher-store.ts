import { create } from 'zustand'

/**
 * 移动启动器开合状态（M3-1 上滑唤起 Launcher）：Bottom Sheet 应用抽屉有了
 * 第二个入口——MobileShell 的底缘上滑手势（`src/mobile/gesture/use-swipe-up.ts`
 * 挂 `mobile-dock-zone`）与 MobileAppGrid 的标题行搜索按钮共享同一开合，
 * 开合入 store——桌面 `launcher-store.ts`（Dock 触发器与 Workspace Rail 共享
 * 启动器面板）同一模式。只放开合，不放搜索词（仍是 MobileLauncher 的本地
 * UI 态）；抽屉自身的 closed/open/leaving 相位机不动（MobileLauncher 组件内）。
 *
 * 关闭统一走 `closeLauncher`（backdrop/Esc/选中应用三路经 MobileLauncher 的
 * onClose 收敛到这里）；选中应用时 select 先 `openApp` 再 onClose，同一
 * commit 内 nav='app' 且 open=false，Home 卸载时无残留开态。
 */
interface MobileLauncherState {
  open: boolean
  openLauncher: () => void
  closeLauncher: () => void
}

export const useMobileLauncherStore = create<MobileLauncherState>()((set) => ({
  open: false,
  openLauncher: () => set((state) => (state.open ? state : { open: true })),
  closeLauncher: () => set((state) => (state.open ? { open: false } : state)),
}))

/** 测试隔离出口：回到初始关闭态。 */
export function resetMobileLauncherStore(): void {
  useMobileLauncherStore.setState({ open: false })
}
