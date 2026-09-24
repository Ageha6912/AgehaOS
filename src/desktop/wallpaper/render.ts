import { STATIC_GRADIENT_STOPS } from '@/core/dynamic/generative/fallbacks'
import { paletteById } from '@/core/dynamic/generative/palettes'
import { COMPOSITIONS } from '@/core/dynamic/generative/templates'
import { mulberry32 } from '@/core/dynamic/generative/seed'
import { evaluateDegrade, TIER_TARGET_FPS } from '@/core/dynamic/governance/tier'
import type { HardwareTier, PlanShape, WallpaperPlan } from '@/core/dynamic/types'

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
  const legacyRidge = (shape: Extract<PlanShape, { kind: 'rect' }>, index: number): void => {
    const shade = planStops(plan)[Math.min(index, planStops(plan).length - 1)]
    ctx.globalAlpha = 0.55 + 0.1 * (index % 3)
    ctx.fillStyle = shade
    ctx.fillRect(shape.x * width, shape.y * height, shape.w * width, shape.h * height)
    ctx.globalAlpha = 1
  }

  const stops = planStops(plan)

  for (const shape of plan.shapes) {
    switch (shape.kind) {
      // —— 山水场景图层（v2）：确定性绘制，无漂移 ——
      case 'sky': {
        const gradient = ctx.createLinearGradient(0, 0, 0, height)
        stops.forEach((stop, index) => {
          gradient.addColorStop(stops.length === 1 ? 0 : index / (stops.length - 1), stop)
        })
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
        break
      }
      case 'celestial': {
        const cx = shape.x * width
        const cy = shape.y * height
        const r = shape.r * Math.min(width, height)
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2)
        glow.addColorStop(0, shape.color)
        glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = shape.moon ? 0.35 : 0.55
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = shape.color
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'stars': {
        const starRng = mulberry32(shape.seed)
        ctx.fillStyle = '#e8edf7'
        for (let i = 0; i < shape.count; i++) {
          const sx = starRng() * width
          const sy = starRng() * height * 0.65
          ctx.globalAlpha = 0.25 + starRng() * 0.65
          const sr = 0.4 + starRng() * 1.2
          ctx.beginPath()
          ctx.arc(sx, sy, sr, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        break
      }
      case 'ridge': {
        const pts = shape.points
        ctx.globalAlpha = shape.alpha
        ctx.fillStyle = shape.color
        ctx.beginPath()
        ctx.moveTo(0, height)
        for (let i = 0; i < pts.length; i += 2) {
          const px = (pts[i] as number) * width
          const py = (shape.baseY - (pts[i + 1] as number) * shape.height) * height
          ctx.lineTo(px, py)
        }
        ctx.lineTo(width, height)
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
        break
      }
      case 'mist': {
        const top = shape.y * height
        const bandH = shape.h * height
        const band = ctx.createLinearGradient(0, top, 0, top + bandH)
        band.addColorStop(0, 'rgba(0,0,0,0)')
        band.addColorStop(0.5, shape.color)
        band.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = shape.alpha
        ctx.fillStyle = band
        ctx.fillRect(0, top, width, bandH)
        ctx.globalAlpha = 1
        break
      }
      case 'water': {
        const top = shape.y * height
        const waterGrad = ctx.createLinearGradient(0, top, 0, height)
        waterGrad.addColorStop(0, shape.color)
        waterGrad.addColorStop(1, 'rgba(0,0,0,0.35)')
        ctx.fillStyle = waterGrad
        ctx.fillRect(0, top, width, height - top)
        // 涟漪：数条水平亮线。
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.lineWidth = 1
        const rippleRng = mulberry32(`ripple|${Math.round(top * 1000)}`)
        for (let i = 0; i < 7; i++) {
          const ry = top + (i + 0.3 + rippleRng() * 0.5) * ((height - top) / 7)
          const rw = width * (0.12 + rippleRng() * 0.3)
          const rx = rippleRng() * (width - rw)
          ctx.beginPath()
          ctx.moveTo(rx, ry)
          ctx.lineTo(rx + rw, ry)
          ctx.stroke()
        }
        break
      }
      case 'birds': {
        ctx.strokeStyle = shape.color
        ctx.lineWidth = Math.max(1, height * 0.0018)
        const birdRng = mulberry32(`birds|${shape.x}|${shape.y}`)
        for (let i = 0; i < shape.count; i++) {
          const bx = (shape.x + (birdRng() - 0.5) * 0.14) * width
          const by = (shape.y + (birdRng() - 0.5) * 0.1) * height
          const s = height * 0.006
          ctx.beginPath()
          ctx.moveTo(bx - s, by)
          ctx.quadraticCurveTo(bx - s / 2, by - s, bx, by)
          ctx.quadraticCurveTo(bx + s / 2, by - s, bx + s, by)
          ctx.stroke()
        }
        break
      }
      // —— v1 抽象图元（旧计划重放）——
      case 'circle': {
        const drift = Math.sin((phase * Math.PI) / 180)
        const x = (shape.x + drift * 0.008) * width
        const y = shape.y * height
        const r = Math.max(shape.w * width, 1.5)
        const color = stops[plan.shapes.indexOf(shape) % stops.length]
        ctx.globalAlpha = 0.28
        const radial = ctx.createRadialGradient(x + r / 2, y + r / 2, 0, x + r / 2, y + r / 2, r)
        radial.addColorStop(0, color)
        radial.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = radial
        ctx.beginPath()
        ctx.arc(x + r / 2, y + r / 2, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        break
      }
      case 'rect': {
        // 山水剪影（旧版）的全宽矩形按包络矩形叠出剪影；其余装饰带慢漂移。
        if (shape.w >= 0.98) {
          legacyRidge(shape, plan.shapes.indexOf(shape))
          break
        }
        const drift = Math.sin((phase * Math.PI) / 180)
        const index = plan.shapes.indexOf(shape)
        const color = stops[index % stops.length]
        ctx.globalAlpha = 0.28
        ctx.fillStyle = color
        ctx.fillRect(
          (shape.x + drift * 0.008 * ((index % 3) + 1)) * width,
          shape.y * height,
          shape.w * width,
          shape.h * height,
        )
        ctx.globalAlpha = 1
        break
      }
    }
  }
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
