import { create } from 'zustand'

/**
 * 桌面弹层互斥槽（2026-10-02 UI 评审 P0-2）：任一时刻至多一个 chrome 弹层
 * （启动器/通知中心/用户菜单/菜单栏下拉/右键菜单/Ctrl+K 搜索）处于打开态。
 * 弹层打开时 claim 自己的 id，被其他 id 顶替即自行关闭（见
 * `usePopoverDismiss`）；关闭时 release，仅当槽仍属于自己才清空。
 */
interface PopoverState {
  active: string | null
  claim: (id: string) => void
  release: (id: string) => void
}

export const usePopoverStore = create<PopoverState>()((set, get) => ({
  active: null,
  claim: (id) => set({ active: id }),
  release: (id) => {
    if (get().active === id) set({ active: null })
  },
}))

/** 测试间隔离。 */
export function resetPopoverStore(): void {
  usePopoverStore.setState({ active: null })
}
