/**
 * 窗口动效的 DOM/WAAPI 应用层（motion-lab/window → 产品归档，docs/DESIGN.md §12）。
 *
 * 契约：
 * - 所有动效只用 transform / opacity，经 WAAPI 在合成器上运行；几何读取
 *   （getBoundingClientRect）只发生在手势触发的一瞬间，不逐帧读。
 * - WAAPI 不可用（jsdom/老浏览器）或 prefers-reduced-motion 时返回 null，
 *   调用方直接落定终态（窗口状态本身由 store 如实先行提交，动效纯表现层）。
 * - 最小化飞行开始前用 inline display 反压 `hidden` 类（store 已提交 minimized
 *   但飞行要继续可见）；飞行结束由 clearInlinePose 交还类名接管。
 */
import {
  CLOSE_SCALE_TO,
  OPEN_SCALE_FROM,
  WINDOW_CLOSE_MS,
  WINDOW_FLIGHT_MS,
  WINDOW_OPEN_MS,
  EASE_CLOSE,
  EASE_OPEN,
  bezier,
  dockPoseTransform,
  flightDelta,
  flightKeyframes,
  originToward,
  type MotionKeyframe,
  type MotionPoint,
} from '@/core/window/motion'

export type FlightGoal = 'open' | 'close' | 'minimize' | 'restore'

/** 互为反向的飞行目标：半途抓回走 anim.reverse()（时间镜像，路径严格对称）。 */
export const REVERSE_GOAL: Record<FlightGoal, FlightGoal> = {
  open: 'close',
  close: 'open',
  minimize: 'restore',
  restore: 'minimize',
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function supportsWAAPI(el: Element): boolean {
  return typeof el.animate === 'function'
}

/**
 * 任务栏锚点：该窗口任务栏按钮的中心（存在则取真实矩形；自动隐藏任务栏
 * 藏于底缘外时钳制到底缘上方 12px，飞行视觉落在屏幕下缘而非视口外）；
 * 找不到按钮时退化为底部中央。
 */
export function taskbarAnchor(windowId: string): MotionPoint {
  const el = document.querySelector(`[data-testid="taskbar-item-${windowId}"]`)
  const rect = el?.getBoundingClientRect()
  const y = window.innerHeight - 12
  if (rect && rect.width > 0 && rect.height > 0) {
    return { x: rect.left + rect.width / 2, y: Math.min(rect.top + rect.height / 2, y) }
  }
  return { x: window.innerWidth / 2, y }
}

/** 飞行结束清干净全部内联位姿（不含 React 管理的 left/top/width/height/zIndex）。 */
export function clearInlinePose(el: HTMLElement): void {
  el.style.transform = ''
  el.style.opacity = ''
  el.style.transformOrigin = ''
  el.style.display = ''
  el.style.pointerEvents = ''
}

/** 打开：scale 0.9→1 + fade，origin 投影到任务栏按钮（从触发源长出来）。 */
export function startOpen(el: HTMLElement, anchor: MotionPoint): Animation | null {
  if (!supportsWAAPI(el)) return null
  const origin = originToward(el.getBoundingClientRect(), anchor)
  el.style.transformOrigin = origin
  return el.animate(
    [
      { transform: `scale(${OPEN_SCALE_FROM})`, opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: WINDOW_OPEN_MS, easing: bezier(EASE_OPEN), fill: 'both' },
  )
}

/** 关闭：同一条路径反向（origin 与打开一致），恒短于打开。 */
export function startClose(el: HTMLElement, anchor: MotionPoint): Animation | null {
  if (!supportsWAAPI(el)) return null
  // 退场即断开命中：垂死窗口的布局盒在飞行期间不变，pointer-events-auto
  // 会吃掉指向下层 UI 的点击（快速「关了就开」的真实操作与 E2E 都会踩）；
  // 它即将消失，点击应直接穿透到下层界面。
  el.style.pointerEvents = 'none'
  const origin = originToward(el.getBoundingClientRect(), anchor)
  el.style.transformOrigin = origin
  return el.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${CLOSE_SCALE_TO})`, opacity: 0 },
    ],
    { duration: WINDOW_CLOSE_MS, easing: bezier(EASE_CLOSE), fill: 'both' },
  )
}

/**
 * genie 收进任务栏：测量（须在挂任何内联位姿之前）→ inline display 反压
 * hidden 类 → 位移 + 横缩纵压 + 渐隐三关键帧正放。
 */
export function startMinimizeFlight(el: HTMLElement, anchor: MotionPoint): Animation | null {
  if (!supportsWAAPI(el)) return null
  el.style.display = 'flex' // React 类名如实反映 store（minimized→hidden）；飞行期反压
  const delta = flightDelta(el.getBoundingClientRect(), anchor)
  el.style.transformOrigin = '50% 50%' // 位移按窗口中心计算，origin 归中
  return el.animate(flightKeyframes(delta), {
    duration: WINDOW_FLIGHT_MS,
    fill: 'both',
  })
}

/**
 * genie 还原：测量干净几何 → 挂任务栏位姿内联（调用方保证在 layout effect
 * 里、绘制前执行，无闪帧）→ 同一组关键帧 anim.reverse() 反向播放
 * （时间镜像 → 路径/节奏严格对称）。
 */
export function startRestoreFlight(el: HTMLElement, anchor: MotionPoint): Animation | null {
  if (!supportsWAAPI(el)) return null
  const delta = flightDelta(el.getBoundingClientRect(), anchor)
  el.style.transformOrigin = '50% 50%'
  el.style.transform = dockPoseTransform(delta)
  el.style.opacity = '0'
  const anim = el.animate(flightKeyframes(delta), {
    duration: WINDOW_FLIGHT_MS,
    fill: 'both',
  })
  anim.reverse() // 从任务栏位姿反向播放回恒等位姿
  return anim
}

export type { MotionKeyframe }
