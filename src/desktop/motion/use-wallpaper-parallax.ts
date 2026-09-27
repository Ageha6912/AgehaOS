import { useEffect, type RefObject } from 'react'

/**
 * 壁纸指针视差（motion-lab enhance-advanced/parallax → 产品归档，docs/DESIGN.md §15）。
 *
 * 照片壁纸是单层位图，三层景深不适用——平面化为单层位移：目标随指针
 * 归一化坐标（-1~1）变化，rAF 每帧 lerp 插值、收敛即停帧（epsilon）、
 * 指针离开视口缓归零；transform 额外带 scale(1.03) 掩住位移露边。
 * rAF 纪律：事件回调只记数据，每帧至多一次样式写；will-change 仅启用期挂载。
 */

/** 单层最大水平位移 px（单层照片取演示模块中景档）。 */
export const PARALLAX_MAX_PX = 22
/** 垂直位移 = 水平 × 该系数（纵向弱化更接近镜头平移感）。 */
export const PARALLAX_VERTICAL_RATIO = 0.55
/** 每帧向目标插值系数（越小越「重」越柔）。 */
export const PARALLAX_LERP = 0.085
/** 收敛阈值（归一化坐标）：与目标差小于它即停帧省电。 */
export const PARALLAX_EPSILON = 0.0012
/** 掩边放大倍率：位移最大 22px 时 1.03 缩放足够不出黑边。 */
export const PARALLAX_SCALE = 1.03

export function useWallpaperParallax(
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      // 降级选型（SPEC §5 跟随类）：背景层不在降级下仍随指针移动。
      return
    }

    const target = { x: 0, y: 0 }
    const cur = { x: 0, y: 0 }
    let rafId = 0

    function apply(): void {
      const vx = cur.x * -1 * PARALLAX_MAX_PX
      const vy = cur.y * -1 * PARALLAX_VERTICAL_RATIO * PARALLAX_MAX_PX
      el!.style.transform = `translate3d(${vx.toFixed(2)}px, ${vy.toFixed(2)}px, 0) scale(${PARALLAX_SCALE})`
    }

    function tick(): void {
      rafId = 0
      cur.x += (target.x - cur.x) * PARALLAX_LERP
      cur.y += (target.y - cur.y) * PARALLAX_LERP
      apply()
      if (
        Math.abs(target.x - cur.x) < PARALLAX_EPSILON &&
        Math.abs(target.y - cur.y) < PARALLAX_EPSILON
      ) {
        cur.x = target.x
        cur.y = target.y
        apply()
        return // 收敛即停帧省电；指针再动由事件重新唤醒
      }
      rafId = requestAnimationFrame(tick)
    }

    function ensureRunning(): void {
      if (!rafId) rafId = requestAnimationFrame(tick)
    }

    function onPointerMove(event: PointerEvent): void {
      target.x = (event.clientX / window.innerWidth) * 2 - 1
      target.y = (event.clientY / window.innerHeight) * 2 - 1
      ensureRunning()
    }

    function onPointerLeave(): void {
      target.x = 0
      target.y = 0
      ensureRunning()
    }

    el.style.willChange = 'transform'
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      if (rafId) cancelAnimationFrame(rafId)
      el.style.transform = ''
      el.style.willChange = ''
    }
  }, [targetRef, enabled])
}
