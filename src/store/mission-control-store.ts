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
 *
 * W11（审计 §13 B②）：restore/focus 分派读**点击一刻的 live 状态**，不信渲染
 * 期快照 `win.state`——卡片快照可能过期（渲染后、点击前窗被其他路径最小化，
 * 如 sidebar showDesktop/应用自最小化），快照 normal 而 live 已 minimized 时
 * 旧实现走 `focus()`，而引擎 focus() 永不解除最小化（window-manager 头注）会
 * **静默拒绝**——点击「切不过去」且原焦点原样保留（生产烟雾反馈的根因）。
 * 竞态依据：switchSpace 的 `space.switched`→space-focus 恢复（W3 记忆窗）在
 * 上一行**同步先行**完成，此处的 restore/focus 是同一任务内最后一次聚焦写，
 * 故「卡片点击的最终焦点=被点窗口」由调用序直接保证，无微任务竞态窗口。
 */
export function activateCardWindow(win: ActivatableWindow): void {
  const spaceStore = useSpaceStore.getState()
  if (win.spaceId !== spaceStore.activeSpaceId) spaceStore.switchSpace(win.spaceId)
  const windowStore = useWindowStore.getState()
  const live = windowStore.windows.find((entry) => entry.id === win.id)
  if (!live) return // 关窗竞态：卡片点了但窗已关——零动作（卡随重渲染消失）
  if (live.state === 'minimized') windowStore.restore(win.id)
  else windowStore.focus(win.id)
}

/** 测试间隔离。 */
export function resetMissionControlStore(): void {
  useMissionControlStore.setState({ open: false, editingSpaceId: null })
}
