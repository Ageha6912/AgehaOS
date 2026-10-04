import { create } from 'zustand'

/**
 * 启动器开合状态（Desktop Shell 3.0 STEP 1 Workspace Rail）：Dock 触发器与
 * 左侧 Workspace Rail 的「启动器」项共享同一面板，开合入 store——与
 * notification-store.panelOpen（P2-2 顶栏铃铛/左栏共享通知中心）同一模式。
 * 只放开合，不放搜索词/分类（仍是 AppLauncher 的本地 UI 态）。
 */
interface LauncherState {
  launcherOpen: boolean
  setLauncherOpen: (open: boolean) => void
  toggleLauncher: () => void
}

export const useLauncherStore = create<LauncherState>()((set, get) => ({
  launcherOpen: false,

  setLauncherOpen: (open) => set({ launcherOpen: open }),
  toggleLauncher: () => set({ launcherOpen: !get().launcherOpen }),
}))

/** 测试间隔离。 */
export function resetLauncherStore(): void {
  useLauncherStore.setState({ launcherOpen: false })
}
