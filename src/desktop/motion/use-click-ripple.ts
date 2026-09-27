import { useEffect, type RefObject } from 'react'

/**
 * 点击涟漪（motion-lab enhance-basic/click-ripple → 产品归档，docs/DESIGN.md §15）。
 *
 * 本接入只挂桌面空白画布层（host 自身即涟漪宿主）：pointerdown 落在宿主
 * 本身（非图标/窗口/任务栏等子元素）时注入一枚扩散圆，animationend 自清理
 * + 超时兜底。扩散动画由 CSS keyframes 完成（300ms，铁律上限档），JS 不逐帧；
 * reduced-motion 不注入（反馈退化为宿主 :active 微缩放）。
 */

export const RIPPLE_DURATION_MS = 300
/** 起始不透明度。 */
export const RIPPLE_START_ALPHA = 0.4
/** 覆盖系数：直径 =「点击点到最远角距离 ×2」× 该值，保证任意点铺满。 */
export const RIPPLE_COVER = 1.15
/** 直径上限：防止超大容器一次生成巨图层拖累合成器。 */
export const RIPPLE_MAX_DIAMETER = 720

export function useClickRipple(hostRef: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const host = hostRef.current
    if (!host || !enabled) return
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    function spawn(x: number, y: number): void {
      const rect = host!.getBoundingClientRect() // 一次读布局（点击瞬间，非逐帧）
      let maxDist = 0
      for (const [cx, cy] of [
        [rect.left, rect.top],
        [rect.right, rect.top],
        [rect.left, rect.bottom],
        [rect.right, rect.bottom],
      ]) {
        const dist = Math.hypot(cx - x, cy - y)
        if (dist > maxDist) maxDist = dist
      }
      const diameter = Math.min(maxDist * 2 * RIPPLE_COVER, RIPPLE_MAX_DIAMETER)

      const ripple = document.createElement('span')
      ripple.className = 'os-ripple'
      ripple.style.setProperty('--cr-d', `${diameter.toFixed(0)}px`)
      ripple.style.setProperty('--cr-x', `${(x - rect.left).toFixed(1)}px`)
      ripple.style.setProperty('--cr-y', `${(y - rect.top).toFixed(1)}px`)
      ripple.style.setProperty('--cr-alpha', String(RIPPLE_START_ALPHA))
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
      host!.appendChild(ripple)
      // 兜底清理：animationend 不触发（宿主 display:none 等）也不残留
      window.setTimeout(() => {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple)
      }, RIPPLE_DURATION_MS + 200)
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      // 只有空白画布出涟漪：宿主自身，或其上的壁纸层（壁纸盖住整个画布，
      // 空白点击的实际 target 是它）；图标/窗口/任务栏等交互元素不在此列。
      if (target !== host && !target.closest('[data-testid="wallpaper-layer"]')) return
      spawn(event.clientX, event.clientY)
    }

    host.addEventListener('pointerdown', onPointerDown)
    return () => {
      host.removeEventListener('pointerdown', onPointerDown)
    }
  }, [hostRef, enabled])
}
