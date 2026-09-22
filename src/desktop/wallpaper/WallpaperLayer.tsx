import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { systemBus } from '@/core/events'
import type { WallpaperPlan } from '@/core/dynamic/types'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { cssGradient, drawPlan } from './render'

/**
 * 壁纸层（设计文档 §4.5）：常驻两层，新壁纸在上层 0→1 交叉淡入；
 * 过渡中再次触发生成时，直接替换上层目标并从当前不透明度继续过渡（不回弹、不排队）。
 * prefers-reduced-motion 时 150ms；canvas 不可用时回落 CSS 渐变（能力探测，PRD §31）。
 */

const FADE_MS_NORMAL = 600
const FADE_MS_REDUCED = 150
const MOUNT_DELAY_MS = 20

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function WallpaperLayer() {
  const plan = useDynamicDesktopStore((s) => s.currentPlan)
  const tier = useDynamicDesktopStore((s) => s.tier)
  const hideBadge = useDynamicDesktopStore((s) => s.prefs.hideBadge)
  const pinned = useDynamicDesktopStore((s) => s.prefs.pinned)
  const { t } = useTranslation()

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

  const showBadge = plan !== null && !pinned && !hideBadge
  const badgePlan = pinned ? null : plan

  return (
    <div className="absolute inset-0" data-testid="wallpaper-layer">
      {front && <WallpaperSurface plan={front} tier={tier} active={back === null} />}
      {back && (
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
      {showBadge && badgePlan && (
        <div
          data-testid="ai-badge"
          title={`${t('dynamicDesktop.badgeTitle')} · ${t(
            `dynamicDesktop.style.${badgePlan.style}` as 'dynamicDesktop.style.fluid-gradient',
          )}`}
          className="absolute bottom-14 right-3 z-10 rounded-full border border-border/60 bg-surface/70 px-2.5 py-1 text-[10px] text-text-muted backdrop-blur-sm"
        >
          ✦ {t('dynamicDesktop.badgeLabel')}
        </div>
      )}
    </div>
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
