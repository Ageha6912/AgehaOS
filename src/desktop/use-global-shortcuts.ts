import { useEffect } from 'react'

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
 * - Alt+W     轻点=可见窗口轮转焦点；按住=呼出 Window Switcher 循环选择，
 *             松开提交（W6 三段交互，审计 .tmp/spaces-audit.md §9）
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
      //（与 switcher Esc 同纪律，首个命中停止语义）；inline 重命名编辑中
      // when 让位（input 自理 Esc=还原，registry 不抢、MC 不关）。
      registerShortcut({
        id: 'mission.control.escape',
        when: () => missionControlOpen() && useMissionControlStore.getState().editingSpaceId === null,
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
      // W6：面板开启期间的 'w' 键（审计 §9「无论 altKey」）——keydown（含
      // repeat 与面板开启中的再按）循环选中，keyup 提交。不设 altKey 门：兜住
      // 「Alt 先于 W 松开」的 keyup 丢修饰竞态；范围由 when 收窄到面板开启
      // 窗口期（≈一次 Alt+W 按住的寿命，keyup 丢失另有 blur 兜底提交）。
      registerShortcut({
        id: 'window.switcher',
        when: () => switcherOpen(),
        test: (event) => event.key.toLowerCase() === 'w',
        run: (event) => {
          event.preventDefault()
          cycleFromLiveHandler()
        },
        onKeyUp: commitFromLiveHandler,
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
        // 条目不参与 keydown 分发，开面板路径不会二次触发）。
        when: () => !switcherOpen(),
        test: (event) =>
          event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'w',
        run: (event) => {
          event.preventDefault()
          if (event.repeat) return
          // 轻点路径（审计 §9「肌肉记忆兼容」）：与迁移前逐字节一致——
          // 同一函数、同一调用点，keydown 即落焦点（既有用例零改动保持绿）。
          cycleWindows()
          // 多窗（active Space 含 minimized ≥2）开面板+预选刚聚焦窗；
          // 0/1 窗由状态机内部 no-op（按住也不开面板）。
          openFromLiveHandler()
        },
      }),
    ]
    return () => {
      for (const off of unregister) off()
      detach()
    }
  }, [])
}
