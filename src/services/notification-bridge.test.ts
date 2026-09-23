import { beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { resetAppStore } from '@/store/app-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'

import { startNotificationBridge } from './notification-bridge'

beforeEach(() => {
  vi.clearAllMocks()
  resetAppStore()
  resetNotificationStore()
})

describe('notification bridge (PRD §16)', () => {
  it('turns app.crashed into a critical notification with the app name', () => {
    startNotificationBridge()

    systemBus.emit('app.crashed', { appId: 'com.ageha.notes', windowId: 'w1' })

    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0]?.priority).toBe('critical')
    expect(items[0]?.titleKey).toBe('notification.title.appCrashed')
    expect(items[0]?.bodyParams?.app).toBe('Notes')
  })

  it('turns desktop.generation.failed into a notification', () => {
    startNotificationBridge()

    systemBus.emit('desktop.generation.failed', {
      seed: 's1',
      stage: 'gate',
      reason: 'quality-gate',
    })

    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0]?.titleKey).toBe('notification.title.wallpaperFailed')
  })

  it('does not duplicate listeners when started twice', () => {
    startNotificationBridge()
    startNotificationBridge()

    systemBus.emit('app.crashed', { appId: 'com.ageha.notes', windowId: 'w1' })
    expect(useNotificationStore.getState().items).toHaveLength(1)
  })
})
