import { useRef } from 'react'

import { Bell, Check, X } from '@phosphor-icons/react'

import { useLocaleStore, useTranslation } from '@/core/i18n'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { ScrollFadeList } from '@/components/scroll-fade-list'
import {
  notificationBodyText,
  notificationTitleText,
  unreadCount,
  useNotificationStore,
} from '@/store/notification-store'
import type { NotificationItem } from '@/store/notification-store'

/**
 * 通知中心（PRD §16.2）：铃铛 + 历史面板——查看、标记已读、全部已读、
 * 单条删除、清空。未读数以徽标呈现。2026-09-30 起挂顶部菜单栏（§19），
 * 面板自顶栏向下展开。≥1280px 时右栏小组件常驻，面板停靠在右栏左侧，
 * 不再盖住时钟卡（UI 评审 P0-2）。
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
          <p className="mt-1 text-[11px] text-text-muted">{timeOf(item.createdAt, locale)}</p>
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
  // 面板开合入 store（P2-2）：左侧系统导航栏与铃铛共享同一面板。
  const open = useNotificationStore((s) => s.panelOpen)
  const togglePanel = useNotificationStore((s) => s.togglePanel)
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen)
  const panelPhase = useExitPhase(open)
  const items = useNotificationStore((s) => s.items)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clear = useNotificationStore((s) => s.clear)
  const unread = unreadCount(items)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bellRef = useRef<HTMLButtonElement | null>(null)

  usePopoverDismiss(
    'notifications',
    open,
    (reason) => {
      const focusInside = panelRef.current?.contains(document.activeElement) ?? false
      setPanelOpen(false)
      if (reason === 'escape' && focusInside) bellRef.current?.focus()
    },
    { insideRefs: [wrapperRef] },
  )

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={bellRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('notification.center')}
        data-testid="notification-bell"
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
        onClick={togglePanel}
      >
        <Bell size={15} weight="regular" />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-contrast"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {panelPhase.render && (
        // fixed 的包含块是菜单栏（backdrop-filter，坑 67）：菜单栏贴视口
        // 顶部全宽，故 top/right 仍等价于视口坐标。
        <div
          ref={panelRef}
          role="region"
          aria-label={t('notification.center')}
          data-testid="notification-panel"
          className={`popover-panel surface-glass fixed right-3 top-[calc(var(--ag-menubar-height)+0.5rem)] z-50 flex max-h-96 w-80 flex-col p-2 xl:right-[calc(var(--ag-rail-right-width)+1.25rem)] ${popoverMotionClass(panelPhase.exiting)}`}
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-xs font-semibold text-text">{t('notification.center')}</p>
            {items.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="notification-mark-all"
                  className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text"
                  onClick={markAllRead}
                >
                  {t('notification.markAllRead')}
                </button>
                <button
                  type="button"
                  data-testid="notification-clear"
                  className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text"
                  onClick={clear}
                >
                  {t('notification.clear')}
                </button>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            /* Shell 3.1 F2 空态构图同步（任务书 §16：孤行「暂无通知」挂白卡是
               点名反模式，视觉评审 H-notification-empty.png 打回）：居中半透明
               铃铛 + notification.empty 原文案——与右栏「最近通知」卡同一构图
               语言；此处即通知中心本尊，不另设跳转链接。i18n 零新增。 */
            <div className="flex flex-col items-center gap-1.5 px-2 py-8 text-center">
              <span
                data-testid="notification-panel-empty-icon"
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center text-text-tertiary opacity-60"
              >
                <Bell size={30} weight="regular" />
              </span>
              <p className="text-[11px] text-text-tertiary">{t('notification.empty')}</p>
            </div>
          ) : (
            // 列表区必须定高：ScrollFadeList 的 ul 绝对铺满包装层（固有高度 0），
            // 而本面板只有 max-h-96 没有确定高度，flex-1 无自由空间可分——有通知
            // 时整个面板会塌缩到只剩标题行（QA 2026-10-04 通知面板态 0 高）。
            // 沿用 EclosionSection 的「定高 flex-col 容器 + ScrollFadeList」既有
            // 模式：条目多时列表内部滚动，面板仍落在 max-h-96 之内。
            <div data-testid="notification-list-area" className="flex h-60 flex-col">
              <ScrollFadeList className="space-y-1.5" testId="notification-list">
                {items.map((item) => (
                  <NotificationRow key={item.id} item={item} />
                ))}
              </ScrollFadeList>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
