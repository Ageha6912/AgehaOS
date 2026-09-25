import { useEffect, useState } from 'react'

import { Sparkle, Warning } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { notificationBodyText, notificationTitleText, useNotificationStore } from '@/store/notification-store'

/**
 * 桌面 toast（PRD §16.1 的呈现层）：新通知右上角弹出、critical 常驻更久，
 * 点击即读并关闭。只显示最近一条——历史在通知中心，不做 toast 轰炸。
 */

const NORMAL_TTL_MS = 4500
const CRITICAL_TTL_MS = 8000

export function NotificationToasts() {
  const { t } = useTranslation()
  const items = useNotificationStore((s) => s.items)
  const markRead = useNotificationStore((s) => s.markRead)
  const latest = items[0]
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [seenId, setSeenId] = useState<string | null>(null)

  // 新通知到来时解除「已关闭」状态（渲染期派生重置，React 官方模式）；
  // 同一条通知的已读更新不打扰用户。
  if ((latest?.id ?? null) !== seenId) {
    setSeenId(latest?.id ?? null)
    setDismissedId(null)
  }

  useEffect(() => {
    if (!latest || latest.read) return
    const timer = window.setTimeout(
      () => setDismissedId(latest.id),
      latest.priority === 'critical' ? CRITICAL_TTL_MS : NORMAL_TTL_MS,
    )
    return () => window.clearTimeout(timer)
  }, [latest])

  if (!latest || latest.id === dismissedId) return null
  const body = notificationBodyText(latest, t) || null
  const critical = latest.priority === 'critical'

  return (
    <div
      role="status"
      aria-label={t('notification.toasts')}
      data-testid="notification-toast"
      className="surface-glass animate-os-pop-in absolute top-3 right-3 z-50 w-72 rounded-lg border border-border p-3 shadow-window"
    >
      <button
        type="button"
        className="flex w-full items-start gap-2.5 text-left"
        onClick={() => {
          markRead(latest.id)
          setDismissedId(latest.id)
        }}
      >
        <span aria-hidden="true" className={critical ? 'text-danger' : 'text-primary'}>
          {critical ? <Warning size={16} weight="fill" /> : <Sparkle size={16} weight="fill" />}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-text">{notificationTitleText(latest, t)}</span>
          {body && <span className="mt-0.5 block text-xs text-text-muted">{body}</span>}
        </span>
      </button>
    </div>
  )
}
