/**
 * 边缘返回手势判定纯函数（M2-4 边缘返回，HANDOFF §4.0-4 复杂手势第一批）。
 *
 * 全部判定（起点在缘内 / 轴向分类 / 过半或甩动确认 / 跟手进度）抽成无副作用
 * 纯函数——jsdom 算不了真实触控时序，单测直接喂坐标与速度（与 statusbar
 * 「探测拆纯函数」同一手法，HANDOFF §2.7）；hook（use-edge-back.ts）只负责
 * pointer 事件采集与 rAF 节流，不内联任何阈值。
 *
 * 参数化（edge 方向 / 阈值 / 确认速度）为后续 edge gestures 预留：`side`
 * 已支持四向，第二只手势（如右缘、顶缘下拉）换一份 config 即可，判定代码
 * 零改动。
 */

/** 边缘方向：`left` = 左缘向右拖（返回），其余三向为后续手势预留。 */
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom'

/** 横向（x 轴）边缘手势；top/bottom 属纵向，后续手势接入时再消费。 */
export const HORIZONTAL_SIDES: readonly ['left', 'right'] = ['left', 'right']

export interface EdgeBackConfig {
  /** 激活边缘方向。 */
  side: EdgeSide
  /** 边缘激活带宽度（px）：起点必须落在该带内（左缘 ≤24px，DESIGN 口径）。 */
  edgeWidth: number
  /** 距离确认比例：向内位移 > 视口该轴长度 × 此比例即确认（过半 = 0.5）。 */
  confirmRatio: number
  /** 甩动确认速度阈值（px/ms，500px/s ≈ 0.5）：快速甩动无需拖过半。 */
  confirmVelocity: number
  /** 轴向判定死区（px）：总位移超过它才裁决轴向——滤掉点击抖动，
      并保住缘带内的纵向原生滚动（滚动手势在 pointercancel 前的微动不误判）。 */
  axisSlack: number
}

export const DEFAULT_EDGE_BACK_CONFIG: Readonly<EdgeBackConfig> = Object.freeze({
  side: 'left',
  edgeWidth: 24,
  confirmRatio: 0.5,
  confirmVelocity: 0.5,
  axisSlack: 10,
})

export interface ViewportAxis {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** 起点是否在激活带内：按 side 量测到对应屏幕缘的距离（top/bottom 消费
 * height，为后续纵向手势预留）。 */
export function isEdgeOrigin(point: Point, viewport: ViewportAxis, config: EdgeBackConfig): boolean {
  const distanceToEdge =
    config.side === 'left'
      ? point.x
      : config.side === 'right'
        ? viewport.width - point.x
        : config.side === 'top'
          ? point.y
          : viewport.height - point.y
  return distanceToEdge <= config.edgeWidth
}

/**
 * 向内位移：沿激活边法线、以「拖向屏内」为正方向（左缘 → +x，右缘 → −x，
 * 顶缘 → +y，底缘 → −y）。反方向拖拽（向外）位移为负，永不激活。
 */
export function inwardDisplacement(start: Point, current: Point, config: EdgeBackConfig): number {
  switch (config.side) {
    case 'left':
      return current.x - start.x
    case 'right':
      return start.x - current.x
    case 'top':
      return current.y - start.y
    case 'bottom':
      return start.y - current.y
  }
}

/** 轴向裁决：位移没出死区 → `undecided`（继续观察）；向内分量为主且为正 →
 * `inward`（跟手激活）；其余（纵向为主 / 向外拖）→ `reject`（放弃手势，
 * 把交互还给原生滚动与点击）。 */
export function classifyDrag(start: Point, current: Point, config: EdgeBackConfig): 'undecided' | 'inward' | 'reject' {
  const dx = current.x - start.x
  const dy = current.y - start.y
  if (Math.hypot(dx, dy) <= config.axisSlack) return 'undecided'
  const inward = inwardDisplacement(start, current, config)
  if (inward <= 0) return 'reject'
  const lateral = config.side === 'left' || config.side === 'right' ? Math.abs(dy) : Math.abs(dx)
  return inward > lateral ? 'inward' : 'reject'
}

/** 确认判定入参：向内位移 + 实测释放速度（px/ms）。 */
export interface EdgeBackSample {
  /** 向内位移（inwardDisplacement 的输出，恒为「向内为正」）。 */
  inwardDx: number
  /** 释放瞬间的向内速度（px/ms，向内为正）。 */
  velocity: number
  viewport: ViewportAxis
}

/** 过半或快速甩动即确认（HANDOFF §4.0-4）：距离判据与速度判据满足其一。 */
export function shouldConfirmEdgeBack(sample: EdgeBackSample, config: EdgeBackConfig): boolean {
  const axisLength = config.side === 'left' || config.side === 'right' ? sample.viewport.width : sample.viewport.height
  const passedDistance = sample.inwardDx > axisLength * config.confirmRatio
  const passedVelocity = sample.velocity >= config.confirmVelocity
  return passedDistance || passedVelocity
}

/** 跟手位移（px）：1:1 原始向内位移，钳到 [0, 屏轴长]——拖出屏外的部分
 * 不再放大位移（面板最多滑出一个屏宽），无 spring/曲线（跟手 = 原始位移）。 */
export function edgeBackTranslation(inwardDx: number, viewport: ViewportAxis, config: EdgeBackConfig): number {
  const axisLength = config.side === 'left' || config.side === 'right' ? viewport.width : viewport.height
  return Math.min(Math.max(inwardDx, 0), axisLength)
}
