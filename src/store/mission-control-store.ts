import { create } from 'zustand'

import type { WindowState } from '@/core/window'
import { useSpaceStore } from './space-store'
import { useWindowStore } from './window-store'

/**
 * Mission Control store（Window Management 2.0 W7，审计 .tmp/spaces-audit.md
 * §10）：只管全屏调度层的开关与 Space 条 inline 重命名的编辑态——窗口/Space
 * 域数据各归 window-store/space-store，本 store 零域数据。镜像 search-store
 * 的开关范式：zustand 单 store 里「open」同键名只能归状态字段（布尔），开
 * 动作由 `setOpen(true)` / `toggle()` 承担；关闭（含 toggle 到关）一律复位
 * 编辑态——编辑中的 input 随层卸载，不留悬挂编辑。
 */
interface MissionControlState {
  open: boolean
  /** 正在 inline 重命名的 Space id；null=无编辑。 */
  editingSpaceId: string | null
  setOpen: (open: boolean) => void
  toggle: () => void
  close: () => void
  setEditing: (spaceId: string | null) => void
}

export const useMissionControlStore = create<MissionControlState>()((set, get) => ({
  open: false,
  editingSpaceId: null,

  setOpen: (open) =>
    set(open ? { open: true } : { open: false, editingSpaceId: null }),

  toggle: () => get().setOpen(!get().open),

  close: () => get().setOpen(false),

  setEditing: (spaceId) => set({ editingSpaceId: spaceId }),
}))

/** 点击卡片激活入参（结构子集：WindowInstance / WindowCard 卡片快照均可传入）。 */
export interface ActivatableWindow {
  id: string
  spaceId: string
  state: WindowState
}

/**
 * 点击卡片激活语义（W7 审计 §10；放 store 层组合既有 action——引擎零 diff，
 * use-switcher applyFocusToStore 同款）：switchSpace（如需——卡片区=当前
 * Space 口径下的防御分支）+ minimized 卡 restore+focus（restore 自 minimized
 * 回落时内部已 focus）/ 可见窗 focus。模块级导出供单测。
 */
export function activateCardWindow(win: ActivatableWindow): void {
  const spaceStore = useSpaceStore.getState()
  if (win.spaceId !== spaceStore.activeSpaceId) spaceStore.switchSpace(win.spaceId)
  const windowStore = useWindowStore.getState()
  if (win.state === 'minimized') windowStore.restore(win.id)
  else windowStore.focus(win.id)
}

/** 测试间隔离。 */
export function resetMissionControlStore(): void {
  useMissionControlStore.setState({ open: false, editingSpaceId: null })
}
