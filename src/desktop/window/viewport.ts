import type { Viewport } from '@/core/window'

/**
 * 顶部菜单栏常驻（docs/DESIGN.md §19，2026-09-30）：工作区高度扣减菜单栏
 * （拖拽/缩放钳制与最大化都不得伸进顶栏）。底部任务栏自动隐藏并悬浮于
 * 工作区之上（§9）——不为任务栏预留高度。
 *
 * 与 index.css 的 --ag-menubar-height 同值钉扎（src/index.css.test.ts），
 * 运行时读 computedStyle 属同步测量（提示词 §36 禁），故双常量互指。
 */
export const MENUBAR_HEIGHT_PX = 32

export function getWorkspaceViewport(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight - MENUBAR_HEIGHT_PX,
  }
}
