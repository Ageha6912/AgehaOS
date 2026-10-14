import type { SnapBand, Viewport } from '@/core/window'

/**
 * 顶部菜单栏常驻（docs/DESIGN.md §19，2026-09-30）：工作区高度扣减菜单栏
 * （拖拽/缩放钳制与最大化都不得伸进顶栏）。底部任务栏自动隐藏并悬浮于
 * 工作区之上（§9）——不为任务栏预留高度。
 *
 * 与 index.css 的 --ag-menubar-height / --ag-rail-left-width 同值钉扎
 * （src/index.css.test.ts + viewport.test 双侧互指；Desktop Shell 3.0
 * STEP 1：菜单栏 32px / 左侧 Workspace Rail 回归窄轨 80px），运行时读
 * computedStyle 属同步测量（提示词 §36 禁），故双常量互指。
 */
export const MENUBAR_HEIGHT_PX = 32
export const RAIL_LEFT_WIDTH_PX = 80
/** Tailwind sm 断点：左轨 <640px 隐藏（system-rails 组容器的 hidden sm:flex 同值）。 */
export const RAIL_LEFT_BREAKPOINT_PX = 640
export const RAIL_RIGHT_WIDTH_PX = 296
/** Tailwind xl 断点：小组件栏 <1280px 隐藏（WidgetRail 的 hidden xl:flex 同值）。 */
export const RAIL_RIGHT_BREAKPOINT_PX = 1280

function railLeftActive(): boolean {
  return window.innerWidth >= RAIL_LEFT_BREAKPOINT_PX
}

function railRightActive(): boolean {
  return window.innerWidth >= RAIL_RIGHT_BREAKPOINT_PX
}

export function getWorkspaceViewport(): Viewport {
  return {
    width:
      window.innerWidth -
      (railLeftActive() ? RAIL_LEFT_WIDTH_PX : 0) -
      (railRightActive() ? RAIL_RIGHT_WIDTH_PX : 0),
    height: window.innerHeight - MENUBAR_HEIGHT_PX,
  }
}

/**
 * W4 Window Snap（审计 .tmp/spaces-audit.md §7）：工作区带 = snap 目标矩形的
 * 坐标系——left=左轨激活时扣 RAIL_LEFT_WIDTH_PX（轨道下不可点坑，见审计 §1
 * 「snap 坐标系裁决」）、top=菜单栏带、宽高与 getWorkspaceViewport() 同数学
 * （结构性复用防漂移）。与 src/core/window/snap.ts 注释互指；几何换算见
 * calculateSnapGeometry（apps 层禁 import desktop 层，launch.ts 同数学并存）。
 */
export function getWorkspaceBand(): SnapBand {
  return {
    left: railLeftActive() ? RAIL_LEFT_WIDTH_PX : 0,
    top: MENUBAR_HEIGHT_PX,
    width: getWorkspaceViewport().width,
    height: getWorkspaceViewport().height,
  }
}
