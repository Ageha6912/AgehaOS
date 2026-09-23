import { useEffect } from 'react'

import { useSearchStore } from '@/store/search-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 系统快捷键（PRD §26，v0.2 基础集）：
 * - Ctrl/⌘+K  呼出/隐藏全局搜索（PRD §15 统一入口）
 * - Esc       关闭搜索面板
 * - Alt+W     在可见窗口间轮转焦点（浏览器里 Alt+Tab 属操作系统，不可用）
 *
 * capture 阶段监听：保证在应用输入框聚焦时依然生效（shell 级快捷键）。
 */

export function cycleWindows(): void {
  const { windows, focus } = useWindowStore.getState()
  const visible = windows
    .filter((win) => win.state !== 'minimized')
    .sort((a, b) => a.zIndex - b.zIndex)
  if (visible.length < 2) return
  const currentIndex = visible.findIndex((win) => win.focused)
  const next = visible[(currentIndex + 1) % visible.length]
  if (next) focus(next.id)
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        useSearchStore.getState().toggle()
        return
      }
      if (event.key === 'Escape') {
        useSearchStore.getState().close()
        return
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        cycleWindows()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
