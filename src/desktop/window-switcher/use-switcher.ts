import type { WindowState } from '@/core/window'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

/**
 * Window Switcher 状态机（Window Management 2.0 W6，审计 .tmp/spaces-audit.md
 * §9）：纯逻辑零 DOM——输入=窗口快照列表（**active Space、z 降序、含
 * minimized**），事件=open / cycle / commit / cancel / windowsChanged，输出=
 * 面板可见性 + 选中 id + 聚焦指令（经注入的 `applyFocus` 落到 window-store；
 * 纯 factory 可注 spy 单测）。
 *
 * 边缘态全钉扎（审计 §9）：
 * - 0 窗不开面板；1 窗轻点 no-op 且按住也不开面板（open 以 <2 窗拒绝）；
 * - **轻点（按下即松、未 cycle 过）=不开面板的等效语义**：commit 无指令——
 *   keydown 首按的轻点焦点移动由 use-global-shortcuts 的既有 `cycleWindows()`
 *   路径完成，commit 只关面板、不发多余 focus（与迁移前逐字节一致，连多余的
 *   window.focused 事件都不产生）；
 * - **面板开启期间窗口被关闭**：windowsChanged 由组件从 live store 派生，
 *   选中 id 失效自动顺延；提交流前再按 live 快照校验存在性（关窗竞态）；
 * - minimized 提交转 restore+focus（taskbar 同款，见 applyFocus 实现）。
 *
 * 会话序列稳定：windowsChanged 只删消失的、原位更新字段、新窗追加——**不按
 * live z 重排**。cycle 对可见窗即时 focus 会把该窗 zIndex 跳顶，若按 live z
 * 重排，下一次 cycle 的「下一位」会随焦点漂移乱序（Alt+Tab 的 Hold 期列表
 * 同样保持静态轮转序）。
 */

/** 面板条目快照（use-switcher 只认这组字段，不持有 WindowInstance 全量）。 */
export interface SwitcherWindow {
  id: string
  appId: string
  title: string
  zIndex: number
  state: WindowState
  focused: boolean
}

/** 聚焦指令：minimized=true 时执行方走 restore()+focus() 组合（taskbar 同款）。 */
export interface SwitcherCommitDirective {
  windowId: string
  minimized: boolean
}

export interface WindowSwitcherState {
  open: boolean
  selectedId: string | null
  /** 会话轮转序（z 降序入场，含 minimized）；关闭后保留供退场动画渲染。 */
  windows: SwitcherWindow[]
}

export interface SwitcherDeps {
  applyFocus(directive: SwitcherCommitDirective): void
}

export interface WindowSwitcherMachine {
  subscribe(listener: () => void): () => void
  getState(): WindowSwitcherState
  /** 多窗（含 minimized ≥2）开面板+预选；0/1 窗 no-op（不开面板）。 */
  open(windows: SwitcherWindow[]): void
  /** 循环下一位（wrap）：可见窗即时聚焦，minimized 留给 commit。未开 no-op。 */
  cycle(): void
  /** 提交选中；`windows`=提交瞬间的 live 快照（关窗竞态的存在性校验源）。 */
  commit(windows: SwitcherWindow[]): SwitcherCommitDirective | null
  /** 取消：关面板、零聚焦指令（不切换）。 */
  cancel(): void
  /** live 列表变化：删除消失项、原位更新、新窗追加、选中失效顺延、<2 窗自动关。 */
  windowsChanged(windows: SwitcherWindow[]): void
}

export function createWindowSwitcher(deps: SwitcherDeps): WindowSwitcherMachine {
  let state: WindowSwitcherState = { open: false, selectedId: null, windows: [] }
  /** 本次按住是否循环过——轻点（未循环）提交零指令（轻点路径逐字节兼容）。 */
  let cycled = false
  const listeners = new Set<() => void>()

  function commitState(next: WindowSwitcherState): void {
    state = next
    for (const listener of listeners) listener()
  }

  /** 关面板：open 翻 false；windows/selectedId 保留（退场动画渲染最后一帧）。 */
  function close(): void {
    if (!state.open) return
    cycled = false
    commitState({ ...state, open: false })
  }

  /** 选中失效顺延：按旧序列位置取新列表同位条目（越界钳到末位）。 */
  function carryForward(prev: SwitcherWindow[], next: SwitcherWindow[]): string {
    const oldIndex = prev.findIndex((win) => win.id === state.selectedId)
    const fallback = next[Math.min(Math.max(oldIndex, 0), next.length - 1)] ?? next[0]
    return fallback.id
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getState: () => state,

    open(windows) {
      // 0 窗不开面板；1 窗轻点 no-op 且按住也不开（审计 §9 边缘态钉扎）。
      if (state.open || windows.length < 2) return
      cycled = false
      // 预选=当前聚焦窗（keydown 首按的轻点路径 cycleWindows() 已把焦点落到
      // 「z 序下一位」，见 use-global-shortcuts；无聚焦（全最小化）回落 z 顶）。
      const selected = windows.find((win) => win.focused) ?? windows[0]
      if (!selected) return
      commitState({ open: true, selectedId: selected.id, windows })
    },

    cycle() {
      if (!state.open || state.windows.length === 0) return
      const index = state.windows.findIndex((win) => win.id === state.selectedId)
      const next = state.windows[(index + 1) % state.windows.length]
      if (!next) return
      cycled = true
      commitState({ ...state, selectedId: next.id })
      // 可见窗即时聚焦（跟手）；minimized 不抢还原——留给 commit 的
      // restore+focus 组合（审计 §9「浏览期间不高亮即还原」的 Alt+Tab 语义）。
      if (next.state !== 'minimized') {
        deps.applyFocus({ windowId: next.id, minimized: false })
      }
    },

    commit(windows) {
      if (!state.open) return null
      // 轻点（未循环过）：焦点已在位（cycleWindows 首按路径），关面板零指令
      // ——多余 focus 都不发，与迁移前行为逐字节一致。
      if (!cycled) {
        close()
        return null
      }
      // 提交流前再校验存在性（关窗竞态，任务书 §23）：live 快照为准。
      if (windows.length === 0) {
        close()
        return null
      }
      const selectedId =
        state.selectedId && windows.some((win) => win.id === state.selectedId)
          ? state.selectedId
          : carryForward(state.windows, windows)
      const target = windows.find((win) => win.id === selectedId)
      if (!target) {
        close()
        return null
      }
      const directive: SwitcherCommitDirective = {
        windowId: target.id,
        minimized: target.state === 'minimized',
      }
      // 已聚焦的可见窗不重复 focus（避免多余 window.focused 事件/zIndex 跳动）。
      if (directive.minimized || !target.focused) deps.applyFocus(directive)
      close()
      return directive
    },

    cancel() {
      close()
    },

    windowsChanged(windows) {
      if (!state.open) return
      // 面板开启期间窗都被关到 <2：面板失去存在意义，自动关（不提交）。
      if (windows.length < 2) {
        close()
        return
      }
      // 会话序列稳定合并（见文件头）：只删消失、原位更新、新窗追加。
      const merged: SwitcherWindow[] = []
      for (const prev of state.windows) {
        const live = windows.find((win) => win.id === prev.id)
        if (live) merged.push(live)
      }
      for (const live of windows) {
        if (!state.windows.some((prev) => prev.id === live.id)) merged.push(live)
      }
      const selectedId =
        state.selectedId && merged.some((win) => win.id === state.selectedId)
          ? state.selectedId
          : carryForward(state.windows, merged)
      commitState({ ...state, windows: merged, selectedId })
    },
  }
}

/**
 * live 快照派生（审计 §9「windowsChanged 从 live store 派生」）：active Space、
 * z 降序、含 minimized。
 */
export function snapshotSwitcherWindows(): SwitcherWindow[] {
  const { windows } = useWindowStore.getState()
  const { activeSpaceId } = useSpaceStore.getState()
  return windows
    .filter((win) => win.spaceId === activeSpaceId)
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((win) => ({
      id: win.id,
      appId: win.appId,
      title: win.title,
      zIndex: win.zIndex,
      state: win.state,
      focused: win.focused,
    }))
}

/** minimized 提交转 restore()+focus() 组合（taskbar 同款，Taskbar.toggleWindow）。 */
function applyFocusToStore(directive: SwitcherCommitDirective): void {
  const store = useWindowStore.getState()
  if (directive.minimized) store.restore(directive.windowId)
  // 引擎 focus() 永不解除最小化（window-manager 头注）；restore() 自 minimized
  // 回落时内部已 focus，故这里与 Taskbar 同款：minimized 走 restore，其余 focus。
  else store.focus(directive.windowId)
}

function createDefaultMachine(): WindowSwitcherMachine {
  return createWindowSwitcher({ applyFocus: applyFocusToStore })
}

let machine = createDefaultMachine()

/**
 * 模块单例门面（use-global-shortcuts 的快捷键与 WindowSwitcher 组件共用）：
 * resetWindowSwitcher 重建内部机器后门面引用稳定（挂载方零感知）。
 * openFromLive/commitFromLive 等在调用瞬间从 live store 派生快照——面板开启
 * 期间关窗/失焦兜底都拿到提交一刻的真实列表。
 */
export const windowSwitcher = {
  subscribe: (listener: () => void): (() => void) => machine.subscribe(listener),
  getState: (): WindowSwitcherState => machine.getState(),
  openFromLive: (): void => machine.open(snapshotSwitcherWindows()),
  cycleFromLive: (): void => {
    machine.windowsChanged(snapshotSwitcherWindows())
    machine.cycle()
  },
  commitFromLive: (): SwitcherCommitDirective | null =>
    machine.commit(snapshotSwitcherWindows()),
  windowsChangedFromLive: (): void => machine.windowsChanged(snapshotSwitcherWindows()),
  cancel: (): void => machine.cancel(),
}

/** 测试隔离出口：重建状态机（面板关闭、选中清空）。 */
export function resetWindowSwitcher(): void {
  machine = createDefaultMachine()
}

/**
 * 稳定引用的事件处理器（组件 addEventListener / store.subscribe 用——模块级
 * 函数引用恒定，面板开启期 effect 不随渲染重挂）。
 */
export function commitFromLiveHandler(): void {
  machine.commit(snapshotSwitcherWindows())
}

export function windowsChangedFromLiveHandler(): void {
  machine.windowsChanged(snapshotSwitcherWindows())
}

/** keydown 首按开面板（调用瞬间从 live store 派生；0/1 窗内部 no-op）。 */
export function openFromLiveHandler(): void {
  machine.open(snapshotSwitcherWindows())
}

/** 面板开启期间 keydown（repeat/再按）循环下一位（先经 live 变化合并）。 */
export function cycleFromLiveHandler(): void {
  machine.windowsChanged(snapshotSwitcherWindows())
  machine.cycle()
}
