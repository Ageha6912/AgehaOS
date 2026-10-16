import { useEffect } from 'react'

import { isDeleteConfirmOpen } from '@/desktop/mission-control/MissionControl'
import { mountShortcutRegistry, registerShortcut } from '@/desktop/shortcuts/registry'
import {
  commitFromLiveHandler,
  cycleFromLiveHandler,
  openFromLiveHandler,
  windowSwitcher,
} from '@/desktop/window-switcher/use-switcher'
import { useMissionControlStore } from '@/store/mission-control-store'
import { useSearchStore } from '@/store/search-store'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 系统快捷键（PRD §26，v0.2 基础集）：
 * - Ctrl/⌘+K  呼出/隐藏全局搜索（PRD §15 统一入口）
 * - Esc       关闭搜索面板（面板开启期先落 Window Switcher 的取消，见下）
 * - Alt+W     <2 窗轻点=可见窗口轮转焦点（既有 cycleWindows 单步）；多窗=
 *             开**常驻** Window Switcher 面板，W 循环选择、Enter/点击提交、
 *             Esc/backdrop/blur 取消（**W11 真机反馈改版，审计
 *             .tmp/spaces-audit.md §13 A——用户裁决，覆盖 W6「松开提交」**：
 *             轻点时面板闪现几毫秒即消失看不到，改版后松开 W 面板常驻）
 * - Ctrl+Alt+←/→  切换 Space（W3，按 index 轮转；单 Space 时 no-op）
 * - F4        开/关 Mission Control 任务视图（W7，审计 .tmp/spaces-audit.md §10）
 *
 * W3 起统一进中央 shortcut registry（src/desktop/shortcuts/registry.ts）：
 * 本模块只把条目注册进单实例分发器，对外行为与 `cycleWindows` 导出零变化。
 */

// W6（审计 §9）：switcherOpen 挂点接真值——实时读窗口切换器状态机的面板态。
function switcherOpen(): boolean {
  return windowSwitcher.getState().open
}

// W7（审计 §10）：missionControlOpen 挂点——Esc 条目的 when 守卫（inline
// 重命名编辑中让位：input 自理 Esc=还原，registry 不抢）。
function missionControlOpen(): boolean {
  return useMissionControlStore.getState().open
}

export function cycleWindows(): void {
  const { windows, focus } = useWindowStore.getState()
  // Space-aware（W2，审计 .tmp/spaces-audit.md §5 决定 4）：只在当前 Space
  // 的可见窗口间轮转，其他 Space 不参与也不被聚焦。
  const { activeSpaceId } = useSpaceStore.getState()
  const visible = windows
    .filter((win) => win.spaceId === activeSpaceId && win.state !== 'minimized')
    .sort((a, b) => a.zIndex - b.zIndex)
  if (visible.length < 2) return
  const currentIndex = visible.findIndex((win) => win.focused)
  const next = visible[(currentIndex + 1) % visible.length]
  if (next) focus(next.id)
}

/** Space 切换（W3）：按 getSpaces() index 轮转；单 Space 时 switchSpace 拒同 id = no-op。 */
function stepSpace(offset: 1 | -1): void {
  const { spaces, activeSpaceId, switchSpace } = useSpaceStore.getState()
  const currentIndex = spaces.findIndex((space) => space.id === activeSpaceId)
  const next = spaces[(currentIndex + offset + spaces.length) % spaces.length]
  if (next) switchSpace(next.id)
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const detach = mountShortcutRegistry()
    const unregister = [
      registerShortcut({
        id: 'search.toggle',
        test: (event) =>
          (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k',
        run: (event) => {
          event.preventDefault()
          useSearchStore.getState().toggle()
        },
      }),
      // W7（审计 §10）：F4 开/关 Mission Control 任务视图（任务书 §34）。
      // F4 无既有条目争键，注册位次自由——置于 Esc 组之前便于阅读。
      registerShortcut({
        id: 'mission.control.toggle',
        test: (event) => event.key === 'F4',
        run: (event) => {
          event.preventDefault()
          useMissionControlStore.getState().toggle()
        },
      }),
      // W7：MC 开启 → Esc 归 MC 关闭；注册序**必须在搜索 Esc 条目之前**
      //（与 switcher Esc 同纪律，首个命中停止语义）。两处 when 让位：
      // inline 重命名编辑中（input 自理 Esc=还原）与迁移确认弹层开启期
      // （W7 复核 low 备忘：弹层自理 Esc=仅取消弹层，见
      // MissionControl.isDeleteConfirmOpen）——否则 Esc 会越过弹层直关整个
      // MC 层。
      registerShortcut({
        id: 'mission.control.escape',
        when: () =>
          missionControlOpen() &&
          useMissionControlStore.getState().editingSpaceId === null &&
          !isDeleteConfirmOpen(),
        test: (event) => event.key === 'Escape',
        run: () => useMissionControlStore.getState().close(),
      }),
      // W6（审计 §9）：switcher 的 Esc 条目——面板开启 → cancel 不切换；
      // 注册序**必须在搜索 Esc 条目之前**（首个命中停止语义：面板开启期间
      // Esc 归切换器，不落到「关搜索」）。
      registerShortcut({
        id: 'window.switcher.escape',
        when: () => switcherOpen(),
        test: (event) => event.key === 'Escape',
        run: () => windowSwitcher.cancel(),
      }),
      registerShortcut({
        id: 'search.close',
        // Esc 保持「关搜索」单职责（审计 §6：modal 冻结守卫 W7 再评估）。
        test: (event) => event.key === 'Escape',
        run: () => useSearchStore.getState().close(),
      }),
      // W6→W11（审计 §13 A）：面板开启期间的 'w' 键（「无论 altKey」——兜住
      // 「Alt 先于 W 松开」的 keyup 丢修饰竞态）循环下一位（repeat 与再按同
      // 语义）。**W11 用户裁决：keyup 一律不提交**——onKeyUp 用法移除（松开
      // W 面板常驻，提交改走 Enter/点击条目）；registry 的 onKeyUp 基础设施
      // 保留不动（供后续条目使用）。
      registerShortcut({
        id: 'window.switcher',
        when: () => switcherOpen(),
        test: (event) => event.key.toLowerCase() === 'w',
        run: (event) => {
          event.preventDefault()
          cycleFromLiveHandler()
        },
      }),
      // W11（审计 §13 A 决定 3）：面板开启时 Enter=提交当前选中。注册位在
      // switcher 组内（无其他 Enter 条目争键）；焦点落在面板条目上时让位给
      // 原生 button 激活（native click → choose 该条目，防「Tab 到别的条目
      // 按 Enter 却提交了选中」的错位）。preventDefault 同时阻断焦点元素
      // （如 chrome 按钮）的原生激活，防提交后再补一发点击。
      registerShortcut({
        id: 'window.switcher.enter',
        when: () => switcherOpen(),
        test: (event) => event.key === 'Enter',
        run: (event) => {
          if (event.target instanceof Element && event.target.closest('[data-window-switcher-panel]')) {
            return
          }
          event.preventDefault()
          commitFromLiveHandler()
        },
      }),
      registerShortcut({
        id: 'space.prev',
        // Ctrl+Alt+←/→（审计 §6 前置事实：本机 AMD+RTX，无 Intel 热键冲突）。
        test: (event) =>
          event.ctrlKey && event.altKey && !event.metaKey && event.key === 'ArrowLeft',
        run: (event) => {
          event.preventDefault()
          stepSpace(-1)
        },
      }),
      registerShortcut({
        id: 'space.next',
        test: (event) =>
          event.ctrlKey && event.altKey && !event.metaKey && event.key === 'ArrowRight',
        run: (event) => {
          event.preventDefault()
          stepSpace(1)
        },
      }),
      registerShortcut({
        id: 'window.cycle',
        // W6：switcherOpen 时让位（when 自守卫防重复入栈——面板开启期间本
        // 条目不参与 keydown 分发，W 循环由「window.switcher」条目接管）。
        when: () => !switcherOpen(),
        test: (event) =>
          event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'w',
        run: (event) => {
          event.preventDefault()
          // 面板未开时的 repeat 不动作（1 窗按住不开面板，W6 既有钉扎沿用）。
          if (event.repeat) return
          // W11（审计 §13 A 决定 1/5）：多窗开**常驻面板**（选中=z 序下一位、
          // 可见窗即时聚焦，0/1 窗内部 no-op）；面板没开（=0/1 窗）走既有
          // cycleWindows 单步——<2 窗轻点零行为变化（0/1 窗本身 no-op）。
          openFromLiveHandler()
          if (!switcherOpen()) cycleWindows()
        },
      }),
    ]
    return () => {
      for (const off of unregister) off()
      detach()
    }
  }, [])
}
