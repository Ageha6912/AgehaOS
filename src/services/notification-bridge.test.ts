import { beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { resetAppStore } from '@/store/app-store'
import { resetEclosionStore } from '@/store/eclosion-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'

import { startNotificationBridge } from './notification-bridge'

beforeEach(() => {
  vi.clearAllMocks()
  resetAppStore()
  resetEclosionStore()
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

  it('turns eclosion.app.failed (重试后仍失败) into a notification with the spec title', () => {
    startNotificationBridge()

    systemBus.emit('eclosion.app.failed', {
      appId: 'com.ageha.eclosion.calculator',
      specId: 'calculator',
      reason: 'render-timeout',
    })

    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0]?.titleKey).toBe('notification.title.eclosionAppFailed')
    expect(items[0]?.bodyKey).toBe('notification.body.eclosionAppFailed')
    // 羽化应用未进 app-store：名字回落规格标题键。
    expect(items[0]?.bodyParams?.app).toBe('计算器')
  })

  it('uses the no-fallback wording for today-domain apps (L2 无原生真身)', () => {
    startNotificationBridge()

    systemBus.emit('eclosion.app.failed', {
      appId: 'com.ageha.eclosion.app-01',
      specId: 'app-01',
      reason: 'ai-not-configured',
    })

    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0]?.titleKey).toBe('notification.title.eclosionAppFailed')
    expect(items[0]?.bodyKey).toBe('notification.body.eclosionAppFailedNoFallback')
    expect(items[0]?.bodyParams?.app).toBe('com.ageha.eclosion.app-01')
  })

  it('keeps generation progress out of notifications (只有终态回落才通知)', () => {
    startNotificationBridge()

    systemBus.emit('eclosion.app.generating', {
      appId: 'com.ageha.eclosion.clock',
      specId: 'clock',
    })
    systemBus.emit('eclosion.app.ready', {
      appId: 'com.ageha.eclosion.clock',
      specId: 'clock',
      source: 'network',
    })

    expect(useNotificationStore.getState().items).toHaveLength(0)
  })

  it('turns eclosion.world.ready into one notification per world day', () => {
    startNotificationBridge()

    systemBus.emit('eclosion.world.ready', { worldDate: '2026-10-03' })
    const { items } = useNotificationStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0]?.titleKey).toBe('notification.title.worldReady')
    expect(items[0]?.bodyKey).toBe('notification.body.worldReady')

    // 同日重播（当日缓存命中/开关重开重跑接线）：不重复打扰。
    systemBus.emit('eclosion.world.ready', { worldDate: '2026-10-03' })
    expect(useNotificationStore.getState().items).toHaveLength(1)

    // 跨日换新：新的一条。
    systemBus.emit('eclosion.world.ready', { worldDate: '2026-10-04' })
    expect(useNotificationStore.getState().items).toHaveLength(2)
  })
})
