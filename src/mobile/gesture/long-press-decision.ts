/**
 * 长按手势判定纯函数（M3-6 Files 长按操作单，HANDOFF §4.0-7「Files 右键操作
 * 等价入口」）：按压驻留计时 + 位移超限取消两段判定抽成无副作用纯函数——
 * jsdom 算不了真实触控时序，单测直接喂时长与坐标（与 edge-back-decision /
 * statusbar sources「探测拆纯函数」同一手法）；hook（use-long-press.ts）只
 * 负责 pointer 事件采集与计时器，不内联任何阈值。
 *
 * 与 Files 既有「首击选中、再击打开」语义共存：按下即计时，阈值内抬起 =
 * 正常点击（不激活、click 抑制器从未挂上，点击原样交给行按钮）；驻留到阈
 * = 长按确认。纵向滚动意图由位移超限取消（浏览器接管滚动即 pointercancel，
 * 同样静默复位——与 use-edge-back 的轴向 reject 同一让位哲学）。
 */

export interface LongPressConfig {
  /** 驻留确认阈值（ms）：按压时长 ≥ 此值即长按（业界惯值 500ms）。 */
  thresholdMs: number
  /** 位移容忍（px）：按下位置到当前位置的直线距离超过它即取消驻留
      （滚动/拖拽意图）——与 edge-back 轴向死区 10px 同档。 */
  moveTolerancePx: number
}

export const DEFAULT_LONG_PRESS_CONFIG: Readonly<LongPressConfig> = Object.freeze({
  thresholdMs: 500,
  moveTolerancePx: 10,
})

export interface Point {
  x: number
  y: number
}

/** 驻留到阈判定：按压时长 ≥ thresholdMs 即长按确认（恰好到阈也算）。 */
export function isLongPressDwell(elapsedMs: number, config: LongPressConfig): boolean {
  return elapsedMs >= config.thresholdMs
}

/** 位移超限判定：直线距离 > moveTolerancePx 即取消（等于容忍值不算——
 * 死区口径与 edge-back 的 classifyDrag 一致，滤抖动不滤真实拖拽）。 */
export function exceedsMoveTolerance(start: Point, current: Point, config: LongPressConfig): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > config.moveTolerancePx
}
