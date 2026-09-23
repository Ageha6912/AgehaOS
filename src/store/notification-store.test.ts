import { beforeEach, describe, expect, it } from 'vitest'

import {
  NOTIFICATION_LIMIT,
  resetNotificationStore,
  unreadCount,
  useNotificationStore,
} from './notification-store'

function pushOf(id: string): void {
  useNotificationStore.getState().push({
    appId: 'system',
    titleKey: 'notification.title.appCrashed',
    bodyKey: 'notification.body.appCrashed',
    bodyParams: { app: id },
  })
}

beforeEach(() => {
  resetNotificationStore()
})

describe('notification-store (PRD §16.2)', () => {
  it('pushes notifications as unread and reports the unread count', () => {
    pushOf('A')
    pushOf('B')
    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(2)
    expect(items[0]?.bodyParams).toEqual({ app: 'B' })
    expect(unreadCount(items)).toBe(2)
  })

  it('keeps at most NOTIFICATION_LIMIT entries (newest first)', () => {
    for (let index = 0; index < NOTIFICATION_LIMIT + 5; index += 1) {
      pushOf(`n${index}`)
    }
    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(NOTIFICATION_LIMIT)
    expect(items[0]?.bodyParams).toEqual({ app: `n${NOTIFICATION_LIMIT + 4}` })
  })

  it('supports markRead, markAllRead, remove and clear', () => {
    pushOf('A')
    const id = useNotificationStore.getState().push({
      appId: 'system',
      titleKey: 'notification.title.wallpaperFailed',
    })

    useNotificationStore.getState().markRead(id)
    expect(unreadCount(useNotificationStore.getState().items)).toBe(1)

    useNotificationStore.getState().markAllRead()
    expect(unreadCount(useNotificationStore.getState().items)).toBe(0)

    useNotificationStore.getState().remove(id)
    expect(useNotificationStore.getState().items).toHaveLength(1)

    useNotificationStore.getState().clear()
    expect(useNotificationStore.getState().items).toHaveLength(0)
  })
})
