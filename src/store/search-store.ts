import { create } from 'zustand'

/**
 * 全局搜索面板状态（PRD §15，Ctrl+K 呼出）。只管开关——查询与结果由面板
 * 组件自持，避免全局 store 随输入重渲染。
 */
interface SearchState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  close: () => void
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
  close: () => set({ open: false }),
}))

/** 测试间隔离。 */
export function resetSearchStore(): void {
  useSearchStore.setState({ open: false })
}
