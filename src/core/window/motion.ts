/**
 * 窗口生命周期动效的纯数学层（motion-lab/window → 产品归档，docs/DESIGN.md §12）。
 *
 * 来源锚定（SPEC §1.1）：打开/关闭的 transform-origin 投影到任务栏按钮；
 * genie 最小化/还原沿「窗口中心 → 锚点」位移路径飞行，还原是同一组关键帧
 * 反向播放（时间镜像 → 路径严格对称）。本模块零 DOM、零 React，只产出
 * 数据与字符串，DOM/WAAPI 应用在 src/desktop/window/window-motion.ts。
 *
 * 时长归档（motion-lab README §8 开头约定：以产品性能档为准）：
 * open 200ms = --ag-motion-base 同值；close 120ms = --ag-motion-fast 同值
 * （退场降一档，恒短于打开，SPEC §1.4）；飞行 300ms = motion-lab
 * --ml-dur-slow 同值（最大位移取最高档）。贝塞尔控制点与演示模块
 * --ml-ease-* 令牌同值，改演示令牌时需同步此处。
 */

export const WINDOW_OPEN_MS = 200
export const WINDOW_CLOSE_MS = 120
export const WINDOW_FLIGHT_MS = 300
/** Space 切换过渡时长（W3，审计 .tmp/spaces-audit.md §6）：180-400ms 档中值。 */
export const SPACE_SWITCH_MS = 240
/** Space 切换进场横移幅度：容器级 ±24px 方向感淡入（离场即时 hidden，不播退场动画）。 */
export const SPACE_SWITCH_ENTER_OFFSET_PX = 24

/** 弹簧近似（无真过冲的冲劲）= motion-lab --ml-ease-spring 同值。 */
export const EASE_OPEN = [0.32, 0.72, 0, 1] as const
/** 加速退场（消失比出现快）= --ml-ease-in 同值。 */
export const EASE_CLOSE = [0.55, 0, 1, 0.45] as const
/** genie 后段缓收落位 = --ml-ease-standard 同值（产品 --ag-motion-ease 同族）。 */
export const EASE_FLIGHT_LEG2 = [0.2, 0, 0, 1] as const

export const OPEN_SCALE_FROM = 0.9
export const CLOSE_SCALE_TO = 0.92
/** 落入任务栏时横向缩放；纵向压扁 = 横向一半（genie 挤扁感）。 */
export const GENIE_SCALE_X = 0.08
export const GENIE_SCALE_Y = 0.04

export const FLIGHT_MID_OFFSET = 0.55
/** 中段行程比例：横向 <0.5、纵向 >横向 → 先坠后收的弧线。 */
export const FLIGHT_MID_TRAVEL_X = 0.45
export const FLIGHT_MID_TRAVEL_Y = 0.6
export const FLIGHT_MID_SCALE_X = 0.5
export const FLIGHT_MID_SCALE_Y = 0.32
export const FLIGHT_MID_OPACITY = 0.8

/** transform-origin 投影限幅 %（防极端远的锚点产生怪异支点）；任务栏恒在窗口下方，投影 ≥100%。 */
export const ORIGIN_CLAMP_X: readonly [number, number] = [-50, 150]
export const ORIGIN_CLAMP_Y: readonly [number, number] = [100, 140]

export interface MotionRect {
  left: number
  top: number
  width: number
  height: number
}

export interface MotionPoint {
  x: number
  y: number
}

/** genie 单个关键帧（WAAPI Keyframe 的结构子集，便于纯测试；索引签名对齐 lib.dom Keyframe）。 */
export interface MotionKeyframe {
  transform: string
  opacity: number
  offset: number
  easing?: string
  [property: string]: string | number | null | undefined
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** 控制点 → cubic-bezier 缓动字符串（与令牌同值声明，注释互指）。 */
export const bezier = (points: readonly number[]): string =>
  `cubic-bezier(${points[0]}, ${points[1]}, ${points[2]}, ${points[3]})`

/** 窗口中心 → 锚点的位移（要求窗口此刻无 transform 残留）。 */
export function flightDelta(from: MotionRect, anchor: MotionPoint): { dx: number; dy: number } {
  return {
    dx: anchor.x - (from.left + from.width / 2),
    dy: anchor.y - (from.top + from.height / 2),
  }
}

/** 把 transform-origin 投影到锚点（SPEC §1.1 来源锚定），并限幅；零尺寸矩形安全收敛。 */
export function originToward(from: MotionRect, anchor: MotionPoint): string {
  const width = from.width > 0 ? from.width : 1
  const height = from.height > 0 ? from.height : 1
  const x = clamp(((anchor.x - from.left) / width) * 100, ORIGIN_CLAMP_X[0], ORIGIN_CLAMP_X[1])
  const y = clamp(((anchor.y - from.top) / height) * 100, ORIGIN_CLAMP_Y[0], ORIGIN_CLAMP_Y[1])
  return `${x.toFixed(1)}% ${y.toFixed(1)}%`
}

/** genie 三关键帧：位移 + 横缩纵压 + 渐隐，中段偏移制造「先坠后收」弧线。 */
export function flightKeyframes(delta: { dx: number; dy: number }): MotionKeyframe[] {
  const px = (value: number): string => `${value.toFixed(1)}px`
  return [
    {
      transform: 'translate(0px, 0px) scale(1, 1)',
      opacity: 1,
      offset: 0,
      easing: bezier(EASE_CLOSE), // 前段：离窗俯冲加速
    },
    {
      transform: `translate(${px(delta.dx * FLIGHT_MID_TRAVEL_X)}, ${px(delta.dy * FLIGHT_MID_TRAVEL_Y)}) scale(${FLIGHT_MID_SCALE_X}, ${FLIGHT_MID_SCALE_Y})`,
      opacity: FLIGHT_MID_OPACITY,
      offset: FLIGHT_MID_OFFSET,
      easing: bezier(EASE_FLIGHT_LEG2), // 后段：缓收落进任务栏
    },
    {
      transform: `translate(${px(delta.dx)}, ${px(delta.dy)}) scale(${GENIE_SCALE_X}, ${GENIE_SCALE_Y})`,
      opacity: 0,
      offset: 1,
    },
  ]
}

/** genie 起点（Dock 位姿）：与 flightKeyframes 末帧一致，还原飞行从这里起飞。 */
export function dockPoseTransform(delta: { dx: number; dy: number }): string {
  return flightKeyframes(delta)[2].transform
}
