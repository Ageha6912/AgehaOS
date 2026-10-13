import { useEffect } from 'react'

import { mountShortcutRegistry, registerShortcut } from '@/desktop/shortcuts/registry'
import { useSearchStore } from '@/store/search-store'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 系统快捷键（PRD §26，v0.2 基础集）：
 * - Ctrl/⌘+K  呼出/隐藏全局搜索（PRD §15 统一入口）
 * - Esc       关闭搜索面板
 * - Alt+W     在可见窗口间轮转焦点（浏览器里 Alt+Tab 属操作系统，不可用）
 * - Ctrl+Alt+←/→  切换 Space（W3，按 index 轮转；单 Space 时 no-op）
 *
 * W3 起统一进中央 shortcut registry（src/desktop/shortcuts/registry.ts）：
 * 本模块只把条目注册进单实例分发器，对外行为与 `cycleWindows` 导出零变化
 * （审计 .tmp/spaces-audit.md §6：既有用例全数保持绿）。
 */

// W6 挂点（审计 §6）：窗口切换器面板开启时 Alt+W 条目让位；当前恒 false，
// 完整交互（按住循环 vs 呼出面板）由 W6 切片落地。
const switcherOpen = false

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
      registerShortcut({
        id: 'search.close',
        // Esc 保持「关搜索」单职责（审计 §6：modal 冻结守卫 W7 再评估）。
        test: (event) => event.key === 'Escape',
        run: () => useSearchStore.getState().close(),
      }),
      registerShortcut({
        id: 'window.cycle',
        when: () => !switcherOpen,
        test: (event) =>
          event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'w',
        run: (event) => {
          event.preventDefault()
          cycleWindows()
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
    ]
    return () => {
      for (const off of unregister) off()
      detach()
    }
  }, [])
}
