import type { WindowBounds } from './types'

/**
 * W4 Window Snap 纯几何（审计 .tmp/spaces-audit.md §7）：零 DOM——band 由
 * 调用方传入（desktop 层的 getWorkspaceBand()，见
 * src/desktop/window/viewport.ts，两处注释互指防漂移）。坐标裁决（审计 §1）：
 * 窗口画布=全屏坐标、z-40 双岛浮在其上，snap 目标矩形必须用工作区带坐标
 * （同 src/apps/launch.ts:76-85 的 railLeft/railRight/wsTop/wsBottom 数学；
 * apps 层禁 import desktop 层故两处并存）。
 */

/** 工作区带：snap 目标矩形的坐标系（left/top 为全屏画布内的带原点）。 */
export interface SnapBand {
  left: number
  top: number
  width: number
  height: number
}

export type SnapDirection = 'left' | 'right'

/** pointer→意图判定产物：null=不命中任何 snap 缘。 */
export type SnapIntent = { kind: SnapDirection } | { kind: 'maximize' } | null

/** 缘判定带下限（px）：小视口时保底 12px 可命中带。 */
export const SNAP_EDGE_MIN_PX = 12

/**
 * 缘判定带宽：`Math.max(12, Math.round(band.width * 0.02))`——按视口动态
 * 计算（审计 §7 钉死公式，禁硬编码 1920）。
 */
export function snapEdgeWidth(band: SnapBand): number {
  return Math.max(SNAP_EDGE_MIN_PX, Math.round(band.width * 0.02))
}

/**
 * 左右半屏对称几何（审计 §7）：band 底=屏幕底（Dock z-40 浮于窗口 z-30
 * 之上为既有层序，与最大化覆盖语义一致）；Top 方向=最大化，不走本函数
 * （复用「整视口真全屏」语义，§32.5 修订 12，禁改）。
 */
export function calculateSnapGeometry(dir: SnapDirection, band: SnapBand): WindowBounds {
  const halfWidth = band.width / 2
  return dir === 'left'
    ? { x: band.left, y: band.top, width: halfWidth, height: band.height }
    : { x: band.left + band.width - halfWidth, y: band.top, width: halfWidth, height: band.height }
}

/**
 * pointer→意图纯判定（审计 §7：左右缘 + 顶缘）：顶缘判定带命中 → 最大化
 * （顶优先于左右，角落先触顶）；否则左/右缘带命中 → 半屏方向；带外 → null。
 * x/y 为全屏坐标（与 band 原点同坐标系），判定只做算术比较，零布局读取。
 */
export function snapIntentFromPointer(x: number, y: number, band: SnapBand): SnapIntent {
  const edge = snapEdgeWidth(band)
  if (y <= band.top + edge) return { kind: 'maximize' }
  if (x <= band.left + edge) return { kind: 'left' }
  if (x >= band.left + band.width - edge) return { kind: 'right' }
  return null
}
