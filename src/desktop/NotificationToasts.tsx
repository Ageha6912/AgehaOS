import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Sparkle, Warning } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import {
  motionMs,
  toastMotionClass,
  TOAST_EXIT_MS,
} from '@/components/pop-motion'
import {
  notificationBodyText,
  notificationTitleText,
  useNotificationStore,
  type NotificationItem,
} from '@/store/notification-store'

/**
 * 桌面 toast（PRD §16.1 的呈现层，motion-lab menu-toast → 产品归档，
 * docs/DESIGN.md §14）：右上角滑入（200ms）→ 驻留（hover 暂停计时）→
 * 滑出（120ms，恒短于滑入）；同时至多 3 条，固定宽度槽位 translateY 过渡
 * 腾位重排。点击即读并退出。历史在通知中心，不做无限轰炸。
 */

const NORMAL_TTL_MS = 4500
const CRITICAL_TTL_MS = 8000
const TOAST_MAX_VISIBLE = 3
const TOAST_GAP_PX = 10

/** 单条卡片的驻留计时：performance.now() 差值法支持 hover 暂停/续走。 */
function useDwellTimer(active: boolean, remainMs: number, onElapsed: () => void): {
  pause: () => void
  resume: () => void
} {
  const timerRef = useRef<number | null>(null)
  const stampRef = useRef(0)
  const remainRef = useRef(remainMs)
  // 最新回调经 effect 写入（react-hooks/refs：渲染期不得触 ref）
  const elapsedRef = useRef(onElapsed)
  useEffect(() => {
    elapsedRef.current = onElapsed
  }, [onElapsed])

  const clear = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const arm = (delay: number): void => {
    clear()
    stampRef.current = performance.now()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      elapsedRef.current()
    }, delay)
  }

  useEffect(() => {
    if (!active) {
      clear()
      return
    }
    arm(remainRef.current)
    return clear
    // remainMs 初值只在该条首次激活时生效
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return {
    pause: () => {
      if (timerRef.current === null) return
      remainRef.current = Math.max(0, remainRef.current - (performance.now() - stampRef.current))
      clear()
    },
    resume: () => {
      if (timerRef.current !== null) return
      if (remainRef.current <= 0) {
        elapsedRef.current()
        return
      }
      arm(remainRef.current)
    },
  }
}

function ToastCard({
  item,
  exiting,
  onDismissed,
}: {
  item: NotificationItem
  exiting: boolean
  onDismissed: (id: string) => void
}) {
  const { t } = useTranslation()
  const markRead = useNotificationStore((s) => s.markRead)
  const body = notificationBodyText(item, t) || null
  const critical = item.priority === 'critical'

  // 退场相位：120ms 后真正从可见栈移除（motionMs 归零 = reduced 直接切换）。
  const [settle, setSettle] = useState(false)
  useEffect(() => {
    if (!exiting) return
    const timer = window.setTimeout(() => setSettle(true), motionMs(TOAST_EXIT_MS))
    return () => window.clearTimeout(timer)
  }, [exiting])

  const dwell = useDwellTimer(!exiting, critical ? CRITICAL_TTL_MS : NORMAL_TTL_MS, () =>
    onDismissed(item.id),
  )

  if (settle) return null
  return (
    <div
      role="status"
      aria-label={t('notification.toasts')}
      data-testid="notification-toast"
      className={toastMotionClass(exiting)}
      onPointerEnter={() => dwell.pause()}
      onPointerLeave={() => dwell.resume()}
    >
      <button
        type="button"
        className="popover-panel surface-glass flex w-full items-start gap-2.5 p-3 text-left"
        onClick={() => {
          markRead(item.id)
          onDismissed(item.id)
        }}
      >
        <span aria-hidden="true" className={critical ? 'text-danger' : 'text-primary'}>
          {critical ? <Warning size={16} weight="fill" /> : <Sparkle size={16} weight="fill" />}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-text">{notificationTitleText(item, t)}</span>
          {body && <span className="mt-0.5 block text-xs text-text-muted">{body}</span>}
        </span>
      </button>
    </div>
  )
}

export function NotificationToasts() {
  const items = useNotificationStore((s) => s.items)
  // 可见栈：最新的至多 3 条；exiting 的保持占位渲染到滑出结束。
  const [exitingIds, setExitingIds] = useState<string[]>([])
  const [dismissedIds, setDismissedIds] = useState<string[]>([])

  const visible = items
    .filter((item) => !dismissedIds.includes(item.id))
    .slice(0, TOAST_MAX_VISIBLE)

  // store 上限 30 条的历史滚动会把旧条目挤出 items：同步清理已消失 id（渲染期派生重置）。
  const aliveIds = new Set(items.map((item) => item.id))
  const staleDismissed = dismissedIds.some((id) => !aliveIds.has(id))
  const staleExiting = exitingIds.some((id) => !aliveIds.has(id))
  if (staleDismissed || staleExiting) {
    setExitingIds(exitingIds.filter((id) => aliveIds.has(id)))
    setDismissedIds(dismissedIds.filter((id) => aliveIds.has(id)))
  }

  const dismiss = (id: string): void => {
    setExitingIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
    window.setTimeout(() => {
      setExitingIds((ids) => ids.filter((value) => value !== id))
      setDismissedIds((ids) => [...ids, id])
    }, motionMs(TOAST_EXIT_MS))
  }

  // 槽位布局：固定宽度卡片高度稳定；测量后按 translateY 排布，
  // 关闭腾位时其余卡片的 transform 过渡上移（与滑出并行）。
  // 高度缓存进 state、测量结果经延迟一拍提交（坑 4：effect 内不得同步
  // setState）；新卡片首帧以旧偏移渲染、量得高度后由 transform 过渡归位。
  const slotsRef = useRef(new Map<string, HTMLDivElement | null>())
  const [heights, setHeights] = useState<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    let changed = visible.length !== heights.size
    const next = new Map<string, number>()
    for (const item of visible) {
      const height = slotsRef.current.get(item.id)?.offsetHeight ?? 0
      next.set(item.id, height)
      if (height !== heights.get(item.id)) changed = true
    }
    if (!changed) return
    const timer = window.setTimeout(() => setHeights(next), 0)
    return () => window.clearTimeout(timer)
  }, [visible, heights])

  let offsetY = 0
  const offsets = new Map<string, number>()
  for (const item of visible) {
    offsets.set(item.id, offsetY)
    offsetY += (heights.get(item.id) ?? 0) + TOAST_GAP_PX
  }
  const stackHeight = Math.max(0, offsetY - TOAST_GAP_PX)

  if (visible.length === 0) return null

  return (
    // 布局容器仅承担定位与腾位排布（演示模块的「定位层」）；可达性语义
    // 由每张卡片的 role=status 承担。
    <div
      className="pointer-events-none absolute right-3 top-[calc(var(--ag-menubar-height)+0.75rem)] z-50 w-72"
      style={{ height: stackHeight > 0 ? stackHeight : undefined }}
    >
      {visible.map((item) => (
        <div
          key={item.id}
          ref={(el) => {
            slotsRef.current.set(item.id, el)
          }}
          className="absolute inset-x-0 top-0 transition-transform duration-[200ms] ease-[cubic-bezier(0.2,0,0,1)]"
          style={{ transform: `translateY(${offsets.get(item.id) ?? 0}px)` }}
        >
          <div className="pointer-events-auto">
            <ToastCard
              item={item}
              exiting={exitingIds.includes(item.id)}
              onDismissed={dismiss}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
