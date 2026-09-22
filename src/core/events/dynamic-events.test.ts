import { afterEach, describe, expect, it } from 'vitest'

import { systemBus } from './system-bus'
import type { SystemEventMap } from './types'

/** §3.3 事件契约（设计文档）：全部 11 个新事件登记后方可使用（ADR 4）。 */
const DYNAMIC_DESKTOP_EVENTS: Array<keyof SystemEventMap & string> = [
  'desktop.wallpaper.generate-started',
  'desktop.wallpaper.generated',
  'desktop.wallpaper.applied',
  'desktop.wallpaper.fallback',
  'desktop.generation.failed',
  'desktop.layout.suggested',
  'desktop.feedback',
  'desktop.perf.degraded',
  'ai.content.ready',
  'ai.content.blocked',
  'ai.decision.performed',
]

afterEach(() => {
  systemBus.clear()
})

describe('dynamic desktop event contract', () => {
  it('registers all contract event names on the typed bus', () => {
    for (const name of DYNAMIC_DESKTOP_EVENTS) {
      expect(systemBus.listenerCount(name)).toBe(0)
      const off = systemBus.on(name, () => undefined)
      expect(systemBus.listenerCount(name)).toBe(1)
      off()
    }
  })

  it('delays payloads for the Phase A wallpaper events', () => {
    const seen: unknown[] = []
    systemBus.on('desktop.wallpaper.applied', (payload) => seen.push(payload))
    systemBus.emit('desktop.wallpaper.applied', { seed: 's1', tier: 'mid', durationMs: 12 })
    expect(seen).toEqual([{ seed: 's1', tier: 'mid', durationMs: 12 }])
  })

  it('carries feedback and decision-log payloads', () => {
    const seen: unknown[] = []
    systemBus.on('desktop.feedback', (payload) => seen.push(payload))
    systemBus.on('ai.decision.performed', (payload) => seen.push(payload))
    systemBus.emit('desktop.feedback', { signal: 'like', targetId: 'seed-1', weight: 3 })
    systemBus.emit('ai.decision.performed', { domain: 'wallpaper', source: 'local' })
    expect(seen).toHaveLength(2)
  })

  it('isolates a throwing wallpaper handler from the others (§9.2)', () => {
    let reached = false
    systemBus.on('desktop.wallpaper.applied', () => {
      throw new Error('boom')
    })
    systemBus.on('desktop.wallpaper.applied', () => {
      reached = true
    })
    expect(() =>
      systemBus.emit('desktop.wallpaper.applied', { seed: 's', tier: 'low', durationMs: 1 }),
    ).not.toThrow()
    expect(reached).toBe(true)
  })
})
