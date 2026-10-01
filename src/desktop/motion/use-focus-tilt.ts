import { useEffect, useRef, type RefObject } from 'react'

/**
 * 窗口切换转场（motion-lab enhance-advanced/window-tilt → 产品归档，
 * docs/DESIGN.md §32.5 修订 10）：聚焦瞬间新窗口做一次 ≤2deg 的 3D 小起立
 * （crossfade + 轻微 tilt，方向 = 朝上一个焦点窗口所在方向让位）；失焦窗口
 * 由 CSS 类轻微降透明/微缩退后（.is-tilt-dim，transition 天然可中断）。
 * 无 rAF 常驻——只在焦点迁移瞬间读两次几何并播放一次性动画；与 §12 开合/
 * 最小化动效正交（都走 inline pose 的窗口动效期间本动画不启动）。
 */

export const TILT_PARAMS = {
  tiltDegY: 1.6,
  tiltDegX: 0.8,
  scaleFrom: 0.985,
  dim: 0.86,
  scaleUnfocused: 0.995,
  durInMs: 250,
  perspectivePx: 1400,
} as const

export interface TiltAngles {
  rx: number
  ry: number
}

/** 方向计算（纯函数）：新窗口中心相对旧窗口中心的方位决定 rotateX/Y 符号。 */
export function tiltAngles(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number },
): TiltAngles {
  if (!prev) return { rx: 0, ry: 0 }
  const dx = next.x - prev.x
  const dy = next.y - prev.y
  return {
    ry: -Math.sign(dx || 1) * TILT_PARAMS.tiltDegY,
    rx: Math.sign(dy || 1) * TILT_PARAMS.tiltDegX,
  }
}

/** 上一个焦点窗口中心（模块级：焦点迁移是全局序列）。 */
let lastFocusedCenter: { x: number; y: number } | null = null

/** 测试隔离出口。 */
export function resetFocusTilt(): void {
  lastFocusedCenter = null
}

function supportsWAAPI(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate === 'function'
}

function isReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 聚焦小起立：仅在「已挂载窗口的焦点迁移 false→true」时播一次性入场——
 * 开窗/最小化还原走 §12 自有动效（挂载与状态迁移不触发本转场）；JSDOM/
 * 降级路径静默跳过（CSS 失焦微退后不受影响）。
 */
export function useFocusTilt(
  sectionRef: RefObject<HTMLElement | null>,
  focused: boolean,
  minimized: boolean,
  enabled: boolean,
): void {
  const prevFocused = useRef<boolean | null>(null)
  useEffect(() => {
    const was = prevFocused.current
    prevFocused.current = focused
    const el = sectionRef.current
    if (!el || !enabled || minimized) return
    if (was === null || was === focused || !focused) return
    const rect = el.getBoundingClientRect()
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const { rx, ry } = tiltAngles(lastFocusedCenter, center)
    lastFocusedCenter = center
    if (!supportsWAAPI() || isReducedMotion()) return
    el.animate(
      [
        {
          opacity: TILT_PARAMS.dim,
          transform: `perspective(${TILT_PARAMS.perspectivePx}px) scale(${TILT_PARAMS.scaleFrom}) rotateX(${rx}deg) rotateY(${ry}deg)`,
        },
        { opacity: 1, transform: `perspective(${TILT_PARAMS.perspectivePx}px) scale(1) rotateX(0deg) rotateY(0deg)` },
      ],
      { duration: TILT_PARAMS.durInMs, easing: 'ease-out', composite: 'replace' },
    )
  }, [sectionRef, focused, minimized, enabled])
}
