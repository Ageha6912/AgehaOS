import { create } from 'zustand'

import { formatMessage } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'

/**
 * 通知中心状态（PRD §16）：历史查看、标记已读、清空、单条删除。
 *
 * 通知文本一律存 i18n 词典键 + 参数（系统框架文案走词典，铁律 15）；历史
 * 上限 30 条 LRU——通知是易逝信息，不是持久数据，登出清空。
 */

export const NOTIFICATION_LIMIT = 30

export type NotificationPriority = 'normal' | 'critical'

export interface NotificationInput {
  appId: string
  /** 系统通知走词典键（铁律 15）；SDK 应用通知（PRD §17）携带清洗后的字面文本。 */
  titleKey?: MessageKey
  title?: string
  bodyKey?: MessageKey
  body?: string
  /** 渲染时经 formatMessage 填充的占位参数（如 {app}）。 */
  bodyParams?: Record<string, string>
  priority?: NotificationPriority
}

/** 展示文本：字面文本优先（SDK），否则词典键。 */
export function notificationTitleText(
  item: NotificationItem,
  t: (key: MessageKey) => string,
): string {
  return item.title ?? (item.titleKey ? t(item.titleKey) : '')
}

export function notificationBodyText(
  item: NotificationItem,
  t: (key: MessageKey) => string,
): string {
  if (item.body !== undefined) return item.body
  return item.bodyKey ? formatMessage(t(item.bodyKey), item.bodyParams ?? {}) : ''
}

export interface NotificationItem extends NotificationInput {
  id: string
  priority: NotificationPriority
  createdAt: number
  read: boolean
}

interface NotificationState {
  items: NotificationItem[]
  /** 面板开合入 store（P2-2）：顶栏铃铛与左侧系统导航栏共享同一面板。 */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  push: (input: NotificationInput) => string
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clear: () => void
}

let sequence = 0

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  items: [],
  panelOpen: false,

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),

  push: (input) => {
    sequence += 1
    const item: NotificationItem = {
      ...input,
      id: `ntf-${sequence}`,
      priority: input.priority ?? 'normal',
      createdAt: Date.now(),
      read: false,
    }
    set({ items: [item, ...get().items].slice(0, NOTIFICATION_LIMIT) })
    return item.id
  },

  markRead: (id) => {
    set({
      items: get().items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    })
  },

  markAllRead: () => {
    set({ items: get().items.map((item) => ({ ...item, read: true })) })
  },

  remove: (id) => {
    set({ items: get().items.filter((item) => item.id !== id) })
  },

  clear: () => set({ items: [] }),
}))

export function unreadCount(items: NotificationItem[]): number {
  return items.filter((item) => !item.read).length
}

/** 测试间隔离。 */
export function resetNotificationStore(): void {
  useNotificationStore.setState({ items: [], panelOpen: false })
}
