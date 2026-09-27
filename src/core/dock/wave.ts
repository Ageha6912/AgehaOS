/**
 * 任务栏波浪的纯数学层（motion-lab/dock → 产品归档，docs/DESIGN.md §13）。
 *
 * 距离衰减波浪（SPEC §1.3）：scale = 1 + (max-1)·exp(-d²/2σ²)，d 为指针到
 * 图标中心的水平距离——近者放大多、远者趋于 1，连续无跳变；进入包络只是
 * 幅度外衣，包络满格期间波形严格 1:1 跟随指针。本模块零 DOM 零 React，
 * 只产出数值；rAF 引擎见 src/desktop/taskbar/use-dock-wave.ts。
 *
 * 参数归档（motion-lab README §8 约定，以产品档为准）：
 * - enter 120ms = --ag-motion-fast 同值（演示 150ms = --ml-dur-fast 档）；
 * - settle 200ms = --ag-motion-base 同值（SPEC §2「200ms 级」不变）；
 * - σ = 44px：产品图标间距 = 按钮 44px + gap 4px = 48px，σ ≤ 1.2×间距；
 * - maxScale 1.5：任务栏裁剪盒 48px 内 20px 图标放大到 30px + 上浮 3px 仍不出框；
 * - ease [0.2,0,0,1] = --ag-motion-ease 同值声明（rAF 侧无法引用 CSS 变量）。
 * 演示模块的按压缩放（pressScale）不迁入：产品按钮已有全局 :active scale(0.98)。
 */

/** 波峰放大上限（倍）。 */
export const WAVE_MAX_SCALE = 1.5
/** 高斯衰减宽度 σ（px）：产品图标间距 48px，≤ 1.2×间距防波峰重叠。 */
export const WAVE_FALLOFF_RADIUS = 44
/** 波峰处图标额外上浮高度（px），随放大比例线性参与。 */
export const WAVE_LIFT_HEIGHT = 3
/** 指针进入时波浪起势时长 ms（--ag-motion-fast 同值）。 */
export const WAVE_ENTER_MS = 120
/** 指针离开后收敛回落时长 ms（--ag-motion-base 同值）。 */
export const WAVE_SETTLE_MS = 200
/** 起势/收敛共用曲线：--ag-motion-ease 同值（产品 --ml-ease-standard 同族）。 */
export const WAVE_EASE = [0.2, 0, 0, 1] as const

/** 写入/收敛判定阈值：低于它的差异不产生样式写。 */
export const WAVE_EPSILON = 0.0005

/**
 * 三次贝塞尔 y(x) 求值，语义与 CSS cubic-bezier(x1,y1,x2,y2) 完全一致。
 * 先二分求解 x(s) = t（x(s) 单调，二分稳定），再代回 y(s)。
 */
export function cubicBezierAt(ease: readonly number[], t: number): number {
  const [x1, y1, x2, y2] = ease
  if (t <= 0) return 0
  if (t >= 1) return 1
  // 贝塞尔分量式：B(s) = 3(1-s)²s·c1 + 3(1-s)s²·c2 + s³
  const comp = (s: number, c1: number, c2: number): number =>
    3 * (1 - s) * (1 - s) * s * c1 + 3 * (1 - s) * s * s * c2 + s * s * s
  let lo = 0
  let hi = 1
  let s = t
  for (let i = 0; i < 24; i++) {
    const x = comp(s, x1, x2)
    if (Math.abs(x - t) < 1e-5) break
    if (x < t) lo = s
    else hi = s
    s = (lo + hi) / 2
  }
  return comp(s, y1, y2)
}

/** 高斯衰减：scale = 1 + (max-1)·exp(-d²/2σ²)；σ 防御性下限 1。 */
export function gaussianScale(distPx: number, sigma: number, maxScale: number): number {
  const s = Math.max(sigma, 1)
  return 1 + (maxScale - 1) * Math.exp(-(distPx * distPx) / (2 * s * s))
}

/** 单图标目标 scale = 高斯波形 × 进入包络（influence 钳制 0~1）。 */
export function iconScale(distPx: number, influence: number): number {
  const wave = gaussianScale(Math.abs(distPx), WAVE_FALLOFF_RADIUS, WAVE_MAX_SCALE)
  const clamped = Math.min(1, Math.max(0, influence))
  return 1 + (wave - 1) * clamped
}

/** 上浮量：随放大比例线性参与（波峰处 = WAVE_LIFT_HEIGHT）。 */
export function iconLift(scale: number): number {
  const ratio = (scale - 1) / (WAVE_MAX_SCALE - 1)
  return WAVE_LIFT_HEIGHT * Math.min(1, Math.max(0, ratio))
}

/** 图标目标位姿字符串（translateY 写在 scale 之前：上浮量不随缩放被放大）。 */
export function wavePose(scale: number, lift: number): string {
  return `translateY(${(-lift).toFixed(2)}px) scale(${scale.toFixed(4)})`
}
