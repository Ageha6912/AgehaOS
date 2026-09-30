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
export const RAIL_LEFT_WIDTH_PX = 80
/** Tailwind sm 断点：侧栏 <640px 隐藏（Sidebar 的 hidden sm:flex 同值）。 */
export const RAIL_LEFT_BREAKPOINT_PX = 640

function railLeftActive(): boolean {
  return window.innerWidth >= RAIL_LEFT_BREAKPOINT_PX
}

export function getWorkspaceViewport(): Viewport {
  return {
    width: window.innerWidth - (railLeftActive() ? RAIL_LEFT_WIDTH_PX : 0),
    height: window.innerHeight - MENUBAR_HEIGHT_PX,
  }
}
