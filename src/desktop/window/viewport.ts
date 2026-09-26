import type { Viewport } from '@/core/window'

/**
 * 任务栏自动隐藏并悬浮于工作区之上（docs/DESIGN.md §9）——
 * 窗口拥有整个视口，不再为任务栏预留底部高度。
 */
export function getWorkspaceViewport(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}
