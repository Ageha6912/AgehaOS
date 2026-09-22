import { STATIC_GRADIENT_STOPS } from '@/core/dynamic/generative/fallbacks'
import { paletteById } from '@/core/dynamic/generative/palettes'
import { COMPOSITIONS } from '@/core/dynamic/generative/templates'
import { evaluateDegrade, TIER_TARGET_FPS } from '@/core/dynamic/governance/tier'
import type { HardwareTier, WallpaperPlan } from '@/core/dynamic/types'

/**
 * 壁纸渲染（设计文档 §4.1 L2/L3、§4.5 平滑过渡、§7.3 降级阶梯）。
 * 本模块不触 React；canvas 不可用时由组件回落 CSS 渐变（能力探测，PRD §31）。
 */

export function planStops(plan: WallpaperPlan): string[] {
  if (plan.paletteId === 'static-gradient-dark') return STATIC_GRADIENT_STOPS.dark
  if (plan.paletteId === 'static-gradient-light') return STATIC_GRADIENT_STOPS.light
  return paletteById(plan.paletteId)?.stops ?? STATIC_GRADIENT_STOPS.dark
}

export function planAngle(plan: WallpaperPlan): number {
  return COMPOSITIONS.find((c) => c.id === plan.compositionId)?.angle ?? 160
}

/** canvas 不可用时的等价 CSS 渐变（能力探测回落，且是组件测试的确定性路径）。 */
export function cssGradient(plan: WallpaperPlan): string {
  const stops = planStops(plan)
  return `linear-gradient(${planAngle(plan)}deg, ${stops.join(', ')})`
}

export interface DrawOptions {
  animate: boolean
  tier: HardwareTier
  onDegrade?: (action: 'pause-animation' | 'switch-static', measuredFps: number) => void
  /** rAF 注入（测试用）；默认 window.requestAnimationFrame。 */
  requestFrame?: (cb: (time: number) => void) => number
  cancelFrame?: (handle: number) => void
}

/** 绘制一帧。phase 为慢漂移相位（度）；静态图传 0。 */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  plan: WallpaperPlan,
  phase: number,
): void {
  const stops = planStops(plan)
  const angle = (planAngle(plan) * Math.PI) / 180
  const dx = Math.cos(angle) * width
  const dy = Math.sin(angle) * height
  const gradient = ctx.createLinearGradient(
    width / 2 - dx / 2,
    height / 2 - dy / 2,
    width / 2 + dx / 2,
    height / 2 + dy / 2,
  )
  stops.forEach((stop, index) => {
    gradient.addColorStop(stops.length === 1 ? 0 : index / (stops.length - 1), stop)
  })
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const drift = Math.sin((phase * Math.PI) / 180)
  plan.shapes.forEach((shape, index) => {
    // 山水全宽层（w≥0.98）按包络矩形叠出剪影；装饰图元带慢漂移。
    const isRidge = shape.kind === 'rect' && shape.w >= 0.98
    const x = (shape.x + (isRidge ? 0 : drift * 0.008 * ((index % 3) + 1))) * width
    const y = shape.y * height
    const w = shape.w * width
    const h = shape.h * height
    if (isRidge) {
      const shade = stops[Math.min(index, stops.length - 1)]
      ctx.globalAlpha = 0.55 + 0.1 * (index % 3)
      ctx.fillStyle = shade
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
      return
    }
    const color = stops[index % stops.length]
    ctx.globalAlpha = 0.28
    if (shape.kind === 'circle') {
      const r = Math.max(w, 1.5)
      const radial = ctx.createRadialGradient(x + r / 2, y + r / 2, 0, x + r / 2, y + r / 2, r)
      radial.addColorStop(0, color)
      radial.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = radial
      ctx.beginPath()
      ctx.arc(x + r / 2, y + r / 2, r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = color
      ctx.fillRect(x, y, w, h)
    }
    ctx.globalAlpha = 1
  })
}

/**
 * 启动绘制循环：静态（animate=false 或低档）只画一帧；动画档按目标帧率节流的慢漂移，
 * 并按 §7.3 相对阈值做 FPS 降级判定（暂停动画 → 切静态 + 事件）。返回清理函数。
 */
export function drawPlan(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  plan: WallpaperPlan,
  options: DrawOptions,
): () => void {
  const resize = () => {
    const ratio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)
    const w = canvas.clientWidth || 1280
    const h = canvas.clientHeight || 720
    canvas.width = Math.max(1, Math.round(w * ratio))
    canvas.height = Math.max(1, Math.round(h * ratio))
  }
  resize()

  const targetFps = TIER_TARGET_FPS[options.tier]
  if (!options.animate || targetFps <= 0 || plan.animation.kind === 'none') {
    paintFrame(ctx, canvas.width, canvas.height, plan, 0)
    return () => undefined
  }

  const requestFrame =
    options.requestFrame ?? ((cb: (time: number) => void) => window.requestAnimationFrame(cb))
  const cancelFrame = options.cancelFrame ?? ((handle: number) => window.cancelAnimationFrame(handle))

  const minFrameMs = 1000 / targetFps
  const timestamps: number[] = []
  let stopped = false
  let lastPaint = -Infinity
  let phase = 0
  let handle = 0

  const loop = (time: number) => {
    if (stopped) return
    // §7.3 情境暂停：页面不可见即停帧。
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      if (time - lastPaint >= minFrameMs) {
        lastPaint = time
        phase = (phase + 0.12) % 360
        paintFrame(ctx, canvas.width, canvas.height, plan, phase)
        timestamps.push(time)
        while (timestamps.length > 400) timestamps.shift()
        const decision = evaluateDegrade(options.tier, timestamps, time)
        if (decision.action !== 'none') {
          stopped = true
          options.onDegrade?.(decision.action, decision.measuredFps)
          return
        }
      }
    }
    handle = requestFrame(loop)
  }
  handle = requestFrame(loop)
  return () => {
    stopped = true
    cancelFrame(handle)
  }
}
