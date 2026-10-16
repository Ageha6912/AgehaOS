import type { WindowState } from '@/core/window'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

/**
 * Window Switcher 状态机（Window Management 2.0 W6，审计 .tmp/spaces-audit.md
 * §9；**W12 Windows Alt+Tab 同款语义 §14——用户裁决，覆盖 W11 的「常驻面板 +
 * Enter/点击提交」**）：纯逻辑零 DOM——输入=窗口快照列表（**active Space、
 * z 降序、含 minimized**），事件=open / cycle / choose / commit / cancel /
 * windowsChanged，输出=面板可见性 + 选中 id + 聚焦指令（经注入的 `applyFocus`
 * 落到 window-store；纯 factory 可注 spy 单测）。
 *
 * W12 交互定案（审计 §14，Windows Alt+Tab 同款）：按住 Alt+W keydown（非
 * repeat）开面板（选中=z 序下一位，多窗才开），**Alt 按住期间面板驻留**；
 * 面板开启期 W keydown（repeat/连按）循环，Shift+W 或 ← 反向、→ 正向
 * （方向见 cycle 的 direction 参数）；**松开 Alt=提交选中**（提交触发点从
 * W11 的「Enter/点击」扩展出 Alt keyup，经 registry onKeyUp 承载；快速轻点=
 * 面板闪现几毫秒即提交，属 Windows 同款设计）；取消=Esc / backdrop 点击 /
 * window blur（不切换）。W11 的「面板常驻、keyup 一律不提交」随裁决被覆盖，
 * 但 Enter/点击条目两条提交手势保留（补充手势）。
 *
 * 边缘态钉扎（W6 保留 + W12 沿用）：
 * - 0 窗不开面板；1 窗轻点 no-op 且按住也不开面板（open 以 <2 窗拒绝）——
 *   <2 窗轻点由 use-global-shortcuts 走既有 `cycleWindows()` 单步（0/1 窗
 *   本身 no-op，零行为变化）；
 * - **面板开启期间窗口被关闭**：windowsChanged 由组件从 live store 派生，
 *   选中 id 失效自动顺延；提交流前再按 live 快照校验存在性（关窗竞态）；
 * - minimized 提交转 restore+focus（taskbar 同款，见 applyFocus 实现）；
 * - open/cycle 对可见窗即时聚焦（跟手），minimized 留给 commit 的
 *   restore+focus 组合（Alt+Tab「浏览期间不高亮即还原」语义）。
 *
 * 会话序列稳定：windowsChanged 只删消失的、原位更新字段、新窗追加——**不按
 * live z 重排**。cycle/open 对可见窗即时 focus 会把该窗 zIndex 跳顶，若按
 * live z 重排，下一次 cycle 的「下一位」会随焦点漂移乱序（Alt+Tab 的 Hold 期
 * 列表同样保持静态轮转序）。
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

/**
 * 循环方向（W12 §14：Shift+W / ← 反向、W / → 正向）：+1=z 序下一位（wrap），
 * -1=z 序上一位（wrap）。
 */
export type SwitcherCycleDirection = 1 | -1

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
  /** 多窗（含 minimized ≥2）开面板+预选 z 序下一位；0/1 窗 no-op（不开面板）。 */
  open(windows: SwitcherWindow[]): void
  /**
   * 循环选中（wrap）：`direction` 缺省 +1 正向（W12 §14：Shift+W/← 传 -1）；
   * 可见窗即时聚焦，minimized 留给 commit。未开 no-op。
   */
  cycle(direction?: SwitcherCycleDirection): void
  /** 点击选择：把选中切到被点条目后走同一提交流（`windows`=点击一刻 live 快照）。 */
  choose(windowId: string, windows: SwitcherWindow[]): SwitcherCommitDirective | null
  /** 提交选中；`windows`=提交瞬间的 live 快照（关窗竞态的存在性校验源）。 */
  commit(windows: SwitcherWindow[]): SwitcherCommitDirective | null
  /** 取消：关面板、零聚焦指令（不切换）。 */
  cancel(): void
  /** live 列表变化：删除消失项、原位更新、新窗追加、选中失效顺延、<2 窗自动关。 */
  windowsChanged(windows: SwitcherWindow[]): void
}

export function createWindowSwitcher(deps: SwitcherDeps): WindowSwitcherMachine {
  let state: WindowSwitcherState = { open: false, selectedId: null, windows: [] }
  const listeners = new Set<() => void>()

  function commitState(next: WindowSwitcherState): void {
    state = next
    for (const listener of listeners) listener()
  }

  /** 关面板：open 翻 false；windows/selectedId 保留（退场动画渲染最后一帧）。 */
  function close(): void {
    if (!state.open) return
    commitState({ ...state, open: false })
  }

  /** 选中失效顺延：按旧序列位置取新列表同位条目（越界钳到末位）。 */
  function carryForward(prev: SwitcherWindow[], next: SwitcherWindow[]): string {
    const oldIndex = prev.findIndex((win) => win.id === state.selectedId)
    const fallback = next[Math.min(Math.max(oldIndex, 0), next.length - 1)] ?? next[0]
    return fallback.id
  }

  /**
   * 提交流（W11：commit 的唯一实现——choose 复用）：关窗竞态的存在性校验以
   * live 快照为准，选中失效按会话序列同位顺延；minimized 转 restore+focus
   * 指令；已聚焦的可见窗不重复 focus（避免多余 window.focused/zIndex 跳动）。
   */
  function commitSelected(windows: SwitcherWindow[]): SwitcherCommitDirective | null {
    if (!state.open) return null
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
    if (directive.minimized || !target.focused) deps.applyFocus(directive)
    close()
    return directive
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
      // 0 窗不开面板；1 窗轻点 no-op 且按住也不开（W6 边缘态钉扎，W11 沿用）。
      if (state.open || windows.length < 2) return
      // W11：选中=**z 序下一位**（相对当前聚焦窗，wrap；无聚焦回落 z 顶）——
      // 替代 W6 的「预选当前聚焦窗」（旧实现靠 keydown 先跑 cycleWindows 落焦点，
      // 新交互 keydown 只开面板，z-next 选择内聚到状态机）。
      const focusedIndex = windows.findIndex((win) => win.focused)
      const selected =
        focusedIndex === -1 ? windows[0] : windows[(focusedIndex + 1) % windows.length]
      if (!selected) return
      commitState({ open: true, selectedId: selected.id, windows })
      // 可见窗即时聚焦（跟手，与 cycle 同语义）；minimized 不抢还原——留给
      // commit 的 restore+focus 组合。
      if (selected.state !== 'minimized') {
        deps.applyFocus({ windowId: selected.id, minimized: false })
      }
    },

    cycle(direction: SwitcherCycleDirection = 1) {
      if (!state.open || state.windows.length === 0) return
      const index = state.windows.findIndex((win) => win.id === state.selectedId)
      // W12 §14：方向参数——+1 z 序下一位 / -1 上一位（都 wrap；负偏移取模前
      // 先加 length 保证非负）。
      const next =
        state.windows[(index + direction + state.windows.length) % state.windows.length]
      if (!next) return
      commitState({ ...state, selectedId: next.id })
      // 可见窗即时聚焦（跟手）；minimized 不抢还原——留给 commit 的
      // restore+focus 组合（W6「浏览期间不高亮即还原」的 Alt+Tab 语义）。
      if (next.state !== 'minimized') {
        deps.applyFocus({ windowId: next.id, minimized: false })
      }
    },

    choose(windowId, windows) {
      if (!state.open) return null
      // 点击选择：先把会话选中切到被点条目（live 无此窗则维持原选中，交给
      // commitSelected 的关窗竞态顺延），再走同一提交流——点击与 Enter 共享
      // 存在性校验与 minimized 组合语义。
      if (windows.some((win) => win.id === windowId)) {
        commitState({ ...state, selectedId: windowId })
      }
      return commitSelected(windows)
    },

    commit(windows) {
      return commitSelected(windows)
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
 * openFromLive/chooseFromLive/commitFromLive 等在调用瞬间从 live store 派生
 * 快照——面板开启期间关窗/取消兜底都拿到那一刻的真实列表。
 */
export const windowSwitcher = {
  subscribe: (listener: () => void): (() => void) => machine.subscribe(listener),
  getState: (): WindowSwitcherState => machine.getState(),
  openFromLive: (): void => machine.open(snapshotSwitcherWindows()),
  cycleFromLive: (direction: SwitcherCycleDirection = 1): void => {
    machine.windowsChanged(snapshotSwitcherWindows())
    machine.cycle(direction)
  },
  chooseFromLive: (windowId: string): SwitcherCommitDirective | null =>
    machine.choose(windowId, snapshotSwitcherWindows()),
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
 * 稳定引用的事件处理器（组件 addEventListener / store.subscribe / registry
 * onKeyUp 用——模块级函数引用恒定，面板开启期 effect 不随渲染重挂）。
 * W12 §14：同时是 Alt keyup 提交的处理器（松开 Alt=提交选中，Windows Alt+Tab
 * 同款；registry 侧条目见 use-global-shortcuts「window.switcher.alt-commit」）。
 */
export function commitFromLiveHandler(): void {
  machine.commit(snapshotSwitcherWindows())
}

/** blur 兜底取消（W11 改判取消、W12 沿用：window blur=取消，见审计 §14 目标 4）。 */
export function cancelFromLiveHandler(): void {
  machine.cancel()
}

export function windowsChangedFromLiveHandler(): void {
  machine.windowsChanged(snapshotSwitcherWindows())
}

/** keydown 首按开面板（调用瞬间从 live store 派生；0/1 窗内部 no-op）。 */
export function openFromLiveHandler(): void {
  machine.open(snapshotSwitcherWindows())
}

/** 面板开启期间 keydown（repeat/再按）循环选中；W12 §14：Shift+W/← 传 -1 反向。 */
export function cycleFromLiveHandler(direction: SwitcherCycleDirection = 1): void {
  machine.windowsChanged(snapshotSwitcherWindows())
  machine.cycle(direction)
}
