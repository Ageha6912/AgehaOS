import { create } from 'zustand'

/**
 * 移动最近任务开合状态（M3-2 最近任务切换器）：Bottom Sheet 覆盖层（
 * `src/mobile/recents/MobileRecentsSheet.tsx`）的唯一入口 = Dock Home 位的
 * 长按/上滑手势（`src/mobile/dock/use-dock-home-gesture.ts`），开合入
 * store 与开关状态进 store 的桌面/移动先例同口径（mobile-launcher-store：
 * 手势入口与后续可能的第二入口共享同一开合，组件侧只留相位机）。
 *
 * 只放开合，不放卡片数据（数据 = mobile-nav-store 的 apps 记录）；sheet
 * 自身的 closed/open/leaving 相位机不动（MobileRecentsSheet 组件内，三张
 * M2 sheet 同款）。
 *
 * 「空态整层不可达」的分档（本 store 刻意保持无依赖——store 间零 import
 * 的既有纪律）：入口档在 Dock（唯一入口处按 apps.length 放行，MobileDock
 * 订阅 nav store）；兜底档在 sheet 组件内（开着时记录被清空 → 立即退场）。
 * 本 store 的 openRecents 自身幂等（开着时 no-op）。
 */
interface MobileRecentsState {
  open: boolean
  openRecents: () => void
  closeRecents: () => void
}

export const useMobileRecentsStore = create<MobileRecentsState>()((set) => ({
  open: false,
  openRecents: () => set((state) => (state.open ? state : { open: true })),
  closeRecents: () => set((state) => (state.open ? { open: false } : state)),
}))

/** 测试隔离出口：回到初始关闭态。 */
export function resetMobileRecentsStore(): void {
  useMobileRecentsStore.setState({ open: false })
}
