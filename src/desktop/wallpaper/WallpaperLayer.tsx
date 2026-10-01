import { useEffect, useRef, useState } from 'react'

import { systemBus } from '@/core/events'
import type { WallpaperPlan } from '@/core/dynamic/types'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { cssGradient, drawPlan } from './render'

/**
 * 壁纸层（设计文档 §4.5 + §32 参考图对齐）：**照片基底常驻**（出厂默认
 * 壁纸 = 用户提供的无 UI 原版画作，全构图仅转码，public/wallpapers/，
 * 顶部锚定保证蝴蝶/天空在宽屏不被裁），生成式
 * field 计划在启用动态桌面时以 canvas 层交叉淡入覆盖其上——关闭动态桌面
 * （§32 新出厂默认）即回落照片。品牌字标由 DOM 品牌层承载（§31 R2-2 恢复）。
 * 场层过渡规则不变：新壁纸在上层 0→1 交叉淡入；
 * 过渡中再次触发生成时，直接替换上层目标并从当前不透明度继续过渡（不回
 * 弹、不排队）。prefers-reduced-motion 时 150ms；canvas 不可用时回落 CSS
 * 渐变（能力探测，PRD §31）。
 * 壁纸指针视差已随 2026-10-01 用户裁决移除（§15 视差项退役，壁纸静止）。
 */

const FADE_MS_NORMAL = 600
const FADE_MS_REDUCED = 150
const MOUNT_DELAY_MS = 20

/** 出厂照片壁纸（§32 修订）：用户提供的无 UI 原版画作（仅转码，全构图），
 *  路径公开稳定。URL 带版本号：内容更新替换同名文件时防浏览器陈旧缓存。 */
export const DEFAULT_WALLPAPER_SRC = '/wallpapers/ageha-dreamland.jpg?v=3'

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function WallpaperLayer() {
  const plan = useDynamicDesktopStore((s) => s.currentPlan)
  const enabled = useDynamicDesktopStore((s) => s.prefs.enabled)
  const tier = useDynamicDesktopStore((s) => s.tier)

  const [front, setFront] = useState<WallpaperPlan | null>(plan)
  const [back, setBack] = useState<WallpaperPlan | null>(null)
  const [backVisible, setBackVisible] = useState(false)
  const [fading, setFading] = useState(false)
  // 记录上一渲染的计划，用于在渲染期派生过渡状态（React 官方推荐的 props 变化调整模式）。
  const [renderedPlan, setRenderedPlan] = useState<WallpaperPlan | null>(plan)

  if (plan !== renderedPlan) {
    setRenderedPlan(plan)
    if (fading) {
      // 打断规则（§4.5）：淡入进行中直接替换上层目标，从当前不透明度继续过渡，不回弹、不排队。
      setBack(plan)
    } else {
      setBack(plan)
      setBackVisible(false)
      setFading(true)
    }
  }

  useEffect(() => {
    if (!fading || !back) return
    const fadeMs = prefersReducedMotion() ? FADE_MS_REDUCED : FADE_MS_NORMAL
    const mountTimer = window.setTimeout(() => setBackVisible(true), MOUNT_DELAY_MS)
    const completeTimer = window.setTimeout(() => {
      setFront(back)
      setBack(null)
      setBackVisible(false)
      setFading(false)
    }, MOUNT_DELAY_MS + fadeMs)
    return () => {
      window.clearTimeout(mountTimer)
      window.clearTimeout(completeTimer)
    }
  }, [fading, back])

  // 「AI 生成」徽标随照片域退役（2026-09-27 用户裁决：生成式壁纸不显示徽标）。
  // 场层双重门控：计划存在 且 动态桌面开启——开关关闭立即回落照片基底。
  return (
    <div className="absolute inset-0" data-testid="wallpaper-layer">
      <PhotoSurface />
      {enabled && front && <WallpaperSurface plan={front} tier={tier} active={back === null} />}
      {enabled && back && (
        <div
          className="absolute inset-0 transition-opacity ease-in-out"
          style={{
            opacity: backVisible ? 1 : 0,
            transitionDuration: `${prefersReducedMotion() ? FADE_MS_REDUCED : FADE_MS_NORMAL}ms`,
            transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
          }}
          data-testid="wallpaper-layer-incoming"
        >
          <WallpaperSurface plan={back} tier={tier} active />
        </div>
      )}
    </div>
  )
}

/**
 * 照片基底（§32）：单层位图，静止（指针视差已移除）。图片加载失败时
 * 静默透出画布渐变。
 */
function PhotoSurface() {
  return (
    <div
      aria-hidden="true"
      data-testid="wallpaper-surface-photo"
      className="absolute inset-0 bg-cover bg-top"
      style={{ backgroundImage: `url(${DEFAULT_WALLPAPER_SRC})` }}
    />
  )
}

function WallpaperSurface({
  plan,
  tier,
  active,
}: {
  plan: WallpaperPlan
  tier: 'high' | 'mid' | 'low'
  active: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [supportsCanvas] = useState(() => {
    try {
      return typeof document !== 'undefined' && document.createElement('canvas').getContext('2d') !== null
    } catch {
      return false
    }
  })
  const reduced = useRef(prefersReducedMotion())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !supportsCanvas || !active) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const stop = drawPlan(canvas, ctx, plan, {
      animate: tier !== 'low' && !reduced.current,
      tier,
      onDegrade: (action, value) => {
        systemBus.emit('desktop.perf.degraded', { metric: 'fps', value, action })
      },
    })
    return stop
  }, [plan, tier, active, supportsCanvas])

  if (!supportsCanvas) {
    return (
      <div
        className="absolute inset-0"
        style={{ background: cssGradient(plan) }}
        data-testid="wallpaper-surface-css"
      />
    )
  }
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      data-testid="wallpaper-surface-canvas"
    />
  )
}
