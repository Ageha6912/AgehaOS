import { afterEach, describe, expect, it } from 'vitest'

import { systemBus } from './system-bus'
import type { SystemEventMap } from './types'

/**
 * Ageha Spaces 事件契约（Window Management 2.0 W1，审计 .tmp/spaces-audit.md §2；
 * W2 追加 window.space-assigned，见 §5 决定 3）：全部登记进 SystemEventMap
 * 后方可使用（ADR 4，范本 dynamic-events.test.ts）。
 */
const SPACE_EVENTS: Array<keyof SystemEventMap & string> = [
  'space.created',
  'space.deleted',
  'space.switched',
  'space.renamed',
  'space.reordered',
]

afterEach(() => {
  systemBus.clear()
})

describe('space event contract', () => {
  it('registers all contract event names on the typed bus', () => {
    for (const name of SPACE_EVENTS) {
      expect(systemBus.listenerCount(name)).toBe(0)
      const off = systemBus.on(name, () => undefined)
      expect(systemBus.listenerCount(name)).toBe(1)
      off()
    }
  })

  it('carries the id + scalar payload shapes', () => {
    const seen: unknown[] = []
    systemBus.on('space.created', (payload) => seen.push(payload))
    systemBus.on('space.deleted', (payload) => seen.push(payload))
    systemBus.on('space.switched', (payload) => seen.push(payload))
    systemBus.on('space.renamed', (payload) => seen.push(payload))
    systemBus.on('space.reordered', (payload) => seen.push(payload))

    systemBus.emit('space.created', { spaceId: 'space-1' })
    systemBus.emit('space.deleted', { spaceId: 'space-1' })
    systemBus.emit('space.switched', { spaceId: 'space-1', fromSpaceId: 'space-default' })
    systemBus.emit('space.renamed', { spaceId: 'space-1', name: '工作' })
    systemBus.emit('space.reordered', { spaceId: 'space-1', fromIndex: 0, toIndex: 2 })

    expect(seen).toEqual([
      { spaceId: 'space-1' },
      { spaceId: 'space-1' },
      { spaceId: 'space-1', fromSpaceId: 'space-default' },
      { spaceId: 'space-1', name: '工作' },
      { spaceId: 'space-1', fromIndex: 0, toIndex: 2 },
    ])
  })

  it('registers window.space-assigned（W2 窗口归属，发送处 WindowManager.moveWindowToSpace）', () => {
    expect(systemBus.listenerCount('window.space-assigned')).toBe(0)
    const off = systemBus.on('window.space-assigned', () => undefined)
    expect(systemBus.listenerCount('window.space-assigned')).toBe(1)
    off()
  })

  it('carries the { windowId, fromSpaceId, toSpaceId } payload for window.space-assigned', () => {
    const seen: unknown[] = []
    systemBus.on('window.space-assigned', (payload) => seen.push(payload))

    systemBus.emit('window.space-assigned', {
      windowId: 'win-1',
      fromSpaceId: 'space-default',
      toSpaceId: 'space-1',
    })

    expect(seen).toEqual([{ windowId: 'win-1', fromSpaceId: 'space-default', toSpaceId: 'space-1' }])
  })
})
