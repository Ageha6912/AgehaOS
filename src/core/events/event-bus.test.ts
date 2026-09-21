import { describe, it, expect, vi, afterEach } from 'vitest'

import { EventBus } from './event-bus'

interface TestEventMap {
  ping: { count: number }
  pong: { count: number }
}

const createBus = () => new EventBus<TestEventMap>()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EventBus', () => {
  it('delivers the payload to a subscribed handler', () => {
    const bus = createBus()
    const handler = vi.fn()

    bus.on('ping', handler)
    bus.emit('ping', { count: 1 })

    expect(handler).toHaveBeenCalledWith({ count: 1 })
  })

  it('delivers to every handler registered for the event', () => {
    const bus = createBus()
    const first = vi.fn()
    const second = vi.fn()

    bus.on('ping', first)
    bus.on('ping', second)
    bus.emit('ping', { count: 2 })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('does not deliver events with no subscribers', () => {
    const bus = createBus()

    expect(() => bus.emit('ping', { count: 0 })).not.toThrow()
  })

  it('unsubscribes via the function returned by on()', () => {
    const bus = createBus()
    const handler = vi.fn()

    const off = bus.on('ping', handler)
    off()
    bus.emit('ping', { count: 1 })

    expect(handler).not.toHaveBeenCalled()
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('unsubscribes via off()', () => {
    const bus = createBus()
    const handler = vi.fn()

    bus.on('ping', handler)
    bus.off('ping', handler)
    bus.emit('ping', { count: 1 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('once() handles a single emission only', () => {
    const bus = createBus()
    const handler = vi.fn()

    bus.once('ping', handler)
    bus.emit('ping', { count: 1 })
    bus.emit('ping', { count: 2 })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('keeps delivering to later handlers when an earlier handler throws', () => {
    const bus = createBus()
    const errorHandler = vi.fn()
    bus.setErrorHandler(errorHandler)
    const throwing = vi.fn(() => {
      throw new Error('boom')
    })
    const survivor = vi.fn()

    bus.on('ping', throwing)
    bus.on('ping', survivor)
    bus.emit('ping', { count: 1 })

    expect(survivor).toHaveBeenCalledWith({ count: 1 })
    expect(errorHandler).toHaveBeenCalledTimes(1)
    expect(errorHandler.mock.calls[0]?.[1]).toBe('ping')
  })

  it('clear() removes every subscription', () => {
    const bus = createBus()
    bus.on('ping', vi.fn())
    bus.on('pong', vi.fn())

    bus.clear()

    expect(bus.listenerCount('ping')).toBe(0)
    expect(bus.listenerCount('pong')).toBe(0)
  })

  it('does not mutate the handler list while emitting', () => {
    const bus = createBus()
    const late = vi.fn()

    const subscribeLate = () => bus.on('ping', late)

    bus.on('ping', subscribeLate as never)
    expect(() => bus.emit('ping', { count: 1 })).not.toThrow()

    bus.off('ping', subscribeLate as never)
  })
})
