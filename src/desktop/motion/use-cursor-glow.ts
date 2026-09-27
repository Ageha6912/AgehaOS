import { useEffect, type RefObject } from 'react'

/**
 * 桌面指针跟随光晕（motion-lab enhance-basic/cursor-glow → 产品归档，
 * docs/DESIGN.md §15）：320px 光斑以平滑系数 0.18 跟随指针，进出桌面
 * 淡入淡出；rAF 节流、收敛即停帧；光晕层 pointer-events-none，不截胡桌面
 * 空白区的点击/涟漪。reduced-motion 下平滑系数强制 1（1:1 瞬时跟随）。
 */

export const GLOW_SIZE_PX = 320
export const GLOW_OPACITY = 0.5
/** 跟随平滑系数（越小拖尾越长；reduced 强制 1）。 */
export const GLOW_SMOOTHING = 0.18
const HALF = GLOW_SIZE_PX / 2

export function useCursorGlow(
  hostRef: RefObject<HTMLElement | null>,
  orbRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const host = hostRef.current
    const orb = orbRef.current
    if (!host || !orb || !enabled) return
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ease = reduced ? 1 : GLOW_SMOOTHING

    let rect: DOMRect | null = null
    let targetX = 0
    let targetY = 0
    let curX = 0
    let curY = 0
    let rafId = 0

    const measure = (): void => {
      rect = host.getBoundingClientRect()
    }

    function tick(): void {
      rafId = 0
      curX += (targetX - curX) * ease
      curY += (targetY - curY) * ease
      orb!.style.transform = `translate3d(${(curX - HALF).toFixed(1)}px, ${(curY - HALF).toFixed(1)}px, 0)`
      if (Math.abs(targetX - curX) > 0.5 || Math.abs(targetY - curY) > 0.5) {
        rafId = requestAnimationFrame(tick)
      } // 收敛停帧：光斑静置不烧空闲帧；指针再动重新调度
    }

    function schedule(): void {
      if (!rafId) rafId = requestAnimationFrame(tick)
    }

    function onPointerEnter(event: PointerEvent): void {
      measure()
      targetX = event.clientX - rect!.left
      targetY = event.clientY - rect!.top
      curX = targetX // 首现即就地亮起，不从场外飞入
      curY = targetY
      orb!.style.transform = `translate3d(${(curX - HALF).toFixed(1)}px, ${(curY - HALF).toFixed(1)}px, 0)`
      orb!.classList.add('is-visible')
    }

    function onPointerMove(event: PointerEvent): void {
      if (!rect) measure() // 窗口尺寸变化后惰性重测
      targetX = event.clientX - rect!.left
      targetY = event.clientY - rect!.top
      // 指针始终在桌面内移动（如从窗口移到空白处）不会再次触发 pointerenter，
      // 移动时兜底点亮（幂等）。
      orb!.classList.add('is-visible')
      schedule()
    }

    function onPointerLeave(): void {
      orb!.classList.remove('is-visible') // 淡出交给 opacity 过渡
    }

    const invalidate = (): void => {
      rect = null
    }

    host.addEventListener('pointerenter', onPointerEnter)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('resize', invalidate)
    window.addEventListener('scroll', invalidate, { passive: true })

    return () => {
      host.removeEventListener('pointerenter', onPointerEnter)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('scroll', invalidate)
      if (rafId) cancelAnimationFrame(rafId)
      orb.classList.remove('is-visible')
      orb.style.transform = ''
    }
  }, [hostRef, orbRef, enabled])
}
