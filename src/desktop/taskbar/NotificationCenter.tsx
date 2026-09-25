import { useState } from 'react'

import { Bell, Check, X } from '@phosphor-icons/react'

import { useLocaleStore, useTranslation } from '@/core/i18n'
import {
  notificationBodyText,
  notificationTitleText,
  unreadCount,
  useNotificationStore,
} from '@/store/notification-store'
import type { NotificationItem } from '@/store/notification-store'

/**
 * 通知中心（PRD §16.2）：任务栏铃铛 + 历史面板——查看、标记已读、全部已读、
 * 单条删除、清空。未读数以徽标呈现。
 */

function timeOf(createdAt: number, locale: 'zh-CN' | 'en'): string {
  return new Date(createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const markRead = useNotificationStore((s) => s.markRead)
  const remove = useNotificationStore((s) => s.remove)
  const body = notificationBodyText(item, t) || null

  return (
    <li
      data-testid="notification-item"
      className={`rounded-md border p-2.5 ${item.read ? 'border-border bg-surface' : 'border-primary/40 bg-primary/5'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text">
            {!item.read && <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />}
            {notificationTitleText(item, t)}
          </p>
          {body && <p className="mt-0.5 text-xs text-text-muted">{body}</p>}
          <p className="mt-1 text-[10px] text-text-muted">{timeOf(item.createdAt, locale)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!item.read && (
            <button
              type="button"
              aria-label={t('notification.markRead')}
              title={t('notification.markRead')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
              onClick={() => markRead(item.id)}
            >
              <Check size={12} weight="regular" />
            </button>
          )}
          <button
            type="button"
            aria-label={t('notification.remove')}
            title={t('notification.remove')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
            onClick={() => remove(item.id)}
          >
            <X size={12} weight="regular" />
          </button>
        </div>
      </div>
    </li>
  )
}

export function NotificationCenter() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const items = useNotificationStore((s) => s.items)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clear = useNotificationStore((s) => s.clear)
  const unread = unreadCount(items)

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('notification.center')}
        data-testid="notification-bell"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={15} weight="regular" />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-contrast"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label={t('notification.center')}
          data-testid="notification-panel"
          className="surface-glass animate-os-pop-in absolute bottom-10 right-0 z-50 flex max-h-96 w-80 flex-col rounded-lg border border-border p-2 shadow-window"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-xs font-semibold text-text">{t('notification.center')}</p>
            {items.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="notification-mark-all"
                  className="rounded-md px-2 py-1 text-[10px] text-text-muted hover:bg-surface-raised hover:text-text"
                  onClick={markAllRead}
                >
                  {t('notification.markAllRead')}
                </button>
                <button
                  type="button"
                  data-testid="notification-clear"
                  className="rounded-md px-2 py-1 text-[10px] text-text-muted hover:bg-surface-raised hover:text-text"
                  onClick={clear}
                >
                  {t('notification.clear')}
                </button>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-text-muted">{t('notification.empty')}</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto" data-testid="notification-list">
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
