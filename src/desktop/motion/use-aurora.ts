import { useEffect, type RefObject } from 'react'

import {
  AURORA_PARAMS,
  blobPose,
  buildBlobLayout,
  createAuroraRandom,
  hexToRgba,
} from './aurora-engine'

/**
 * 流光渐变氛围挂载（docs/DESIGN.md §32.5 修订 10）：把 aurora-engine 烘焙
 * 到画布并驱动 30fps 上限的合成循环；disabled/无 2D 上下文（jsdom）时安全
 * 不作为。淡入淡出由 CSS transition 消费 canvas 的 opacity。
 */
export function useAurora(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  dark: boolean,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const spriteSize = 256
    const colors = dark ? AURORA_PARAMS.colorsDark : AURORA_PARAMS.colorsLight
    const sprites = colors.map((color) => {
      const c = document.createElement('canvas')
      c.width = spriteSize
      c.height = spriteSize
      const g = c.getContext('2d')
      if (g) {
        const grad = g.createRadialGradient(
          spriteSize / 2,
          spriteSize / 2,
          0,
          spriteSize / 2,
          spriteSize / 2,
          spriteSize / 2,
        )
        grad.addColorStop(0, hexToRgba(color, AURORA_PARAMS.coreAlpha))
        grad.addColorStop(0.55, hexToRgba(color, AURORA_PARAMS.coreAlpha * 0.35))
        grad.addColorStop(1, hexToRgba(color, 0))
        g.fillStyle = grad
        g.fillRect(0, 0, spriteSize, spriteSize)
      }
      return c
    })
    const blobs = buildBlobLayout(AURORA_PARAMS.blobCount, createAuroraRandom())

    function resize(): void {
      const rect = canvas!.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = Math.min(window.devicePixelRatio || 1, AURORA_PARAMS.maxDpr)
      const scale = dpr * AURORA_PARAMS.renderScale
      canvas!.width = Math.max(1, Math.round(rect.width * scale))
      canvas!.height = Math.max(1, Math.round(rect.height * scale))
    }

    function render(t: number): void {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)
      ctx!.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      for (let i = 0; i < blobs.length; i++) {
        const pose = blobPose(blobs[i], t, w, h)
        ctx!.globalAlpha = blobs[i].a
        ctx!.drawImage(sprites[i % sprites.length]!, pose.x - pose.r, pose.y - pose.r, pose.r * 2, pose.r * 2)
      }
      ctx!.globalAlpha = 1
      ctx!.globalCompositeOperation = 'source-over'
    }

    let rafId = 0
    let lastDraw = 0
    function frame(now: number): void {
      rafId = 0
      if (document.hidden) return
      if (now - lastDraw < 1000 / AURORA_PARAMS.fpsCap - 1) {
        rafId = requestAnimationFrame(frame)
        return
      }
      lastDraw = now
      render(now / 1000)
      rafId = requestAnimationFrame(frame)
    }

    function onVisibility(): void {
      if (!document.hidden && !rafId && !reduced) rafId = requestAnimationFrame(frame)
    }
    function onResize(): void {
      resize()
      if (reduced) render(7.3)
    }

    resize()
    canvas.style.opacity = String(dark ? AURORA_PARAMS.alphaDark : AURORA_PARAMS.alphaLight)
    if (reduced) {
      render(7.3) // 降级：静态氛围一帧，循环不启动
    } else {
      rafId = requestAnimationFrame(frame)
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.style.opacity = '0'
    }
  }, [canvasRef, enabled, dark])
}
