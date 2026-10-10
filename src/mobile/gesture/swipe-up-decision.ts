/**
 * 上滑唤起启动器手势判定纯函数（M3-1 上滑 Launcher，HANDOFF §4.0 手势入口）。
 *
 * 与 edge-back-decision.ts 同一手法：全部判定（起点在底缘带内 / 纵向轴向
 * 分类 / 距离或甩动确认 / 跟手位移）抽成无副作用纯函数——jsdom 算不了真实
 * 触控时序，单测直接喂坐标与速度；hook（use-swipe-up.ts）只负责 pointer
 * 事件采集与 rAF 节流，不内联任何阈值。
 *
 * 与边缘返回（M2-4）的空间分工：边缘返回激活在**左缘**、消费横向拖拽；
 * 本手势激活在**底缘**（Dock 底缘 + safe-area 预留带）、消费纵向拖拽——
 * 两者激活带在屏幕上不相交，同一屏可以共存不互斥。
 */

export interface SwipeUpConfig {
  /** 底缘激活带高度（px）：起点必须落在距视口底边 ≤ 此值的带内（覆盖
      Dock 本体 + safe-area 预留带，见 MobileShell 挂载点注释）。 */
  edgeWidth: number
  /** 距离确认比例：上滑位移 > 视口高 × 此比例即确认（0.15 ≈ 800px 高视口
      滑 120px——底缘起手上滑可达整屏，距离档取「明确的一次上滑」而非过半）。 */
  confirmRatio: number
  /** 甩动确认速度阈值（px/ms，500px/s ≈ 0.5，与边缘返回同档）：快速上甩
      无需拖满距离档。 */
  confirmVelocity: number
  /** 轴向判定死区（px）：总位移超过它才裁决轴向——滤掉点击抖动，Dock 位
      点击（tap）不受影响。 */
  axisSlack: number
  /** 跟手位移上限（px）：Dock 随手上抬的钳制值——底缘起手上滑可达整屏，
      Dock 抬满一个钳制值后停住（物理暗示「到顶了」），不跟随整屏位移。 */
  followMaxPx: number
}

export const DEFAULT_SWIPE_UP_CONFIG: Readonly<SwipeUpConfig> = Object.freeze({
  edgeWidth: 72,
  confirmRatio: 0.15,
  confirmVelocity: 0.5,
  axisSlack: 10,
  followMaxPx: 80,
})

export interface Point {
  x: number
  y: number
}

export interface ViewportAxis {
  width: number
  height: number
}

/** 起点是否在底缘激活带内：距视口底边 ≤ edgeWidth（Dock 底缘 + 预留带）。 */
export function isBottomOrigin(point: Point, viewport: ViewportAxis, config: SwipeUpConfig): boolean {
  return viewport.height - point.y <= config.edgeWidth
}

/** 上滑位移（px）：以「向上拖」为正方向（start.y − current.y），向下拖为
 * 负，永不激活。 */
export function upwardDisplacement(start: Point, current: Point): number {
  return start.y - current.y
}

/** 轴向裁决：位移没出死区 → `undecided`（继续观察，点击不受影响）；
 * 上滑分量为主且为正 → `upward`（跟手激活）；其余（横向为主 / 向下拖）
 * → `reject`（放弃手势）。底缘带内没有可被抢的原生滚动面（Dock 与预留带
 * 均不可滚动），reject 纯属手势自放弃。 */
export function classifyVerticalDrag(
  start: Point,
  current: Point,
  config: SwipeUpConfig,
): 'undecided' | 'upward' | 'reject' {
  const dx = current.x - start.x
  const dy = current.y - start.y
  if (Math.hypot(dx, dy) <= config.axisSlack) return 'undecided'
  const upward = upwardDisplacement(start, current)
  if (upward <= 0) return 'reject'
  return upward > Math.abs(dx) ? 'upward' : 'reject'
}

/** 确认判定入参：上滑位移 + 实测释放速度（px/ms）。 */
export interface SwipeUpSample {
  /** 上滑位移（upwardDisplacement 的输出，恒为「向上为正」）。 */
  upwardPx: number
  /** 释放瞬间的向上速度（px/ms，向上为正）。 */
  velocity: number
  viewport: ViewportAxis
}

/** 距离档或甩动档满足其一即确认：距离 = 位移 > 视口高 × confirmRatio；
 * 速度 = 释放速度 ≥ confirmVelocity（150ms pointermove 滑动窗口求出，
 * 见 use-swipe-up.ts——与边缘返回同一事件时序手法，rAF 采样落点求不了
 * 甩速）。 */
export function shouldConfirmSwipeUp(sample: SwipeUpSample, config: SwipeUpConfig): boolean {
  const passedDistance = sample.upwardPx > sample.viewport.height * config.confirmRatio
  const passedVelocity = sample.velocity >= config.confirmVelocity
  return passedDistance || passedVelocity
}

/** 跟手位移（px）：1:1 原始上滑位移，钳到 [0, followMaxPx]——负位移（向下）
 * 不产生上抬，超顶不再放大。 */
export function swipeUpTranslation(upwardPx: number, config: SwipeUpConfig): number {
  return Math.min(Math.max(upwardPx, 0), config.followMaxPx)
}
