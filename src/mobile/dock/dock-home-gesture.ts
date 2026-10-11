/**
 * Dock Home 位手势判定纯函数（M3-2 最近任务入口，HANDOFF §4.0「Dock 的
 * Home 位改为短按回 Home、长按或上滑开最近任务」）。
 *
 * 与 edge-back-decision.ts / swipe-up-decision.ts 同一手法：全部判定（按住
 * 期间位移出死区 = 取消长按 / 释放时上滑位移过阈且上滑为主 = 上滑确认）
 * 抽成无副作用纯函数——jsdom 算不了真实触控时序，单测直接喂坐标；hook
 * （use-dock-home-gesture.ts）只负责 pointer 事件采集与定时器，不内联
 * 任何阈值。
 *
 * 与既有手势的空间分工：
 * - **M3-1 底缘上滑（mobile-dock-zone）**：激活带 = Dock 区底缘，消费纵向
 *   拖拽 → 打开 Launcher。Home 位被标记 `[data-no-edge-back]`（手势家族
 *   的统一逃生口：「该面的指针交互归该面」）——起于 Home 位的手势不进
 *   zone 级手势，由本手势接管（同位上滑语义改为最近任务，切片口径）。
 * - **M2-4 边缘返回**：激活带在屏幕左缘、挂在应用宿主面板上，与本手势
 *   （Dock 区、仅 Home 位 44×44）激活面不相交。
 * - 长按/上滑都没有跟手动画（按钮不位移），逐事件只写 ref、零 React
 *   render，判定收敛在「定时器到点 / 释放」各一次——无逐帧 DOM 工作，
 *   无需 rAF（跟手型手势的 rAF 纪律见 use-edge-back / use-swipe-up）。
 */

export interface DockHomeGestureConfig {
  /** 长按确认时长（ms）：按住不动到点即确认（iOS 主屏长按同档）。 */
  holdMs: number
  /** 位移死区（px）：按住期间位移超过它取消长按定时器（用户在拖拽不是
      在长按；与 edge-back/swipe-up 的 axisSlack 同值口径）。 */
  moveSlopPx: number
  /** 上滑确认位移（px）：释放时上滑超过它且上滑分量为主 → 确认。按钮
      尺寸的目标取小阈值（一个指肚的行程），与整屏手势的视口比例档不同
      级。 */
  swipeUpPx: number
}

export const DEFAULT_DOCK_HOME_GESTURE_CONFIG: Readonly<DockHomeGestureConfig> = Object.freeze({
  holdMs: 500,
  moveSlopPx: 10,
  swipeUpPx: 24,
})

export interface Point {
  x: number
  y: number
}

/** 按住期间位移是否已出死区（出死区 → 取消长按定时器，本轮改走释放判定）。 */
export function holdExceedsSlop(start: Point, current: Point, config: DockHomeGestureConfig): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > config.moveSlopPx
}

/** 释放时是否为「上滑开最近任务」：上滑位移 > swipeUpPx 且上滑分量大于
 * 横向分量（斜拖不算，横向留给 Dock 位点击的原生指针语义）。 */
export function isHomeSwipeUp(start: Point, current: Point, config: DockHomeGestureConfig): boolean {
  const upward = start.y - current.y
  const horizontal = Math.abs(current.x - start.x)
  return upward > config.swipeUpPx && upward > horizontal
}
