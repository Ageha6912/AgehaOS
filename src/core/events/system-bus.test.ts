import { describe, it, expect, vi, afterEach } from 'vitest'

import { systemBus } from './system-bus'
import type { SystemEventMap } from './types'

describe('systemBus', () => {
  afterEach(() => {
    systemBus.clear()
  })

  it('is an EventBus over the system event map', () => {
    const handler = vi.fn<(payload: SystemEventMap['user.login']) => void>()

    systemBus.on('user.login', handler)
    systemBus.emit('user.login', { userId: 'u-1' })

    expect(handler).toHaveBeenCalledWith({ userId: 'u-1' })
  })
})

/**
 * 羽化事件扩图卡门（ADR 4：新增系统事件先扩 SystemEventMap 并补测试）。
 * P1 实发 generating/ready/failed；world.ready 与 app.reported 为预留键，
 * 在此钉住载荷形状，接入期（P2/P4）不改图即可发送。
 */
describe('systemBus × eclosion events（设计 §3.2）', () => {
  afterEach(() => {
    systemBus.clear()
  })

  it('delivers eclosion.app.generating with spec identity', () => {
    const handler = vi.fn<(payload: SystemEventMap['eclosion.app.generating']) => void>()
    systemBus.on('eclosion.app.generating', handler)

    systemBus.emit('eclosion.app.generating', {
      appId: 'com.ageha.eclosion.calculator',
      specId: 'calculator',
    })

    expect(handler).toHaveBeenCalledWith({
      appId: 'com.ageha.eclosion.calculator',
      specId: 'calculator',
    })
  })

  it('delivers eclosion.app.ready for both provenances', () => {
    const handler = vi.fn<(payload: SystemEventMap['eclosion.app.ready']) => void>()
    systemBus.on('eclosion.app.ready', handler)

    systemBus.emit('eclosion.app.ready', {
      appId: 'com.ageha.eclosion.notes',
      specId: 'notes',
      source: 'cache',
    })
    systemBus.emit('eclosion.app.ready', {
      appId: 'com.ageha.eclosion.notes',
      specId: 'notes',
      source: 'network',
    })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls.map((call) => call[0].source)).toEqual(['cache', 'network'])
  })

  it('delivers eclosion.app.failed with a reason string', () => {
    const handler = vi.fn<(payload: SystemEventMap['eclosion.app.failed']) => void>()
    systemBus.on('eclosion.app.failed', handler)

    systemBus.emit('eclosion.app.failed', {
      appId: 'com.ageha.eclosion.clock',
      specId: 'clock',
      reason: 'run-timeout',
    })

    expect(handler).toHaveBeenCalledWith({
      appId: 'com.ageha.eclosion.clock',
      specId: 'clock',
      reason: 'run-timeout',
    })
  })

  it('keeps the reserved world.ready / app.reported keys shapely for P2/P4', () => {
    const world = vi.fn<(payload: SystemEventMap['eclosion.world.ready']) => void>()
    const reported = vi.fn<(payload: SystemEventMap['eclosion.app.reported']) => void>()
    systemBus.on('eclosion.world.ready', world)
    systemBus.on('eclosion.app.reported', reported)

    systemBus.emit('eclosion.world.ready', { worldDate: '2026-10-02' })
    systemBus.emit('eclosion.app.reported', { appId: 'com.ageha.eclosion.clock', windowId: 'w1' })

    expect(world).toHaveBeenCalledWith({ worldDate: '2026-10-02' })
    expect(reported).toHaveBeenCalledWith({ appId: 'com.ageha.eclosion.clock', windowId: 'w1' })
  })

  it('pairs eclosion emissions with the existing ai.decision.performed channel', () => {
    const handler = vi.fn<(payload: SystemEventMap['ai.decision.performed']) => void>()
    systemBus.on('ai.decision.performed', handler)

    systemBus.emit('ai.decision.performed', { domain: 'app', source: 'llm' })
    systemBus.emit('ai.decision.performed', { domain: 'app', source: 'cache' })
    systemBus.emit('ai.decision.performed', { domain: 'app', source: 'local' })

    expect(handler.mock.calls.map((call) => call[0])).toEqual([
      { domain: 'app', source: 'llm' },
      { domain: 'app', source: 'cache' },
      { domain: 'app', source: 'local' },
    ])
  })
})
