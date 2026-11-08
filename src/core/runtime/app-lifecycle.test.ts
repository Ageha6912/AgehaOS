import { describe, it, expect, vi, afterEach } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'
import { WindowManager } from '@/core/window'

import { createAppLifecycleTracker } from './app-lifecycle'

function createHarness() {
  const bus = new EventBus<SystemEventMap>()
  const started = vi.fn()
  const stopped = vi.fn()
  bus.on('app.started', started)
  bus.on('app.stopped', stopped)

  let counter = 0
  const windows = new WindowManager(bus, () => `win-${++counter}`)
  const lifecycle = createAppLifecycleTracker(bus)
  lifecycle.start()

  return { windows, lifecycle, started, stopped }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAppLifecycleTracker', () => {
  it('emits app.started when an app gets its first window', () => {
    const { windows, lifecycle, started } = createHarness()

    windows.create({ appId: 'com.ageha.notes', title: 'Notes' })

    expect(started).toHaveBeenCalledTimes(1)
    expect(started).toHaveBeenCalledWith({ appId: 'com.ageha.notes', windowId: 'win-1' })
    expect(lifecycle.isRunning('com.ageha.notes')).toBe(true)
  })

  it('does not re-emit app.started for further windows of the same app', () => {
    const { windows, started } = createHarness()

    windows.create({ appId: 'com.ageha.notes', title: 'A' })
    windows.create({ appId: 'com.ageha.notes', title: 'B' })

    expect(started).toHaveBeenCalledTimes(1)
  })

  it('emits app.stopped only when the last window of an app closes', () => {
    const { windows, stopped, lifecycle } = createHarness()

    const first = windows.create({ appId: 'com.ageha.notes', title: 'A' })
    const second = windows.create({ appId: 'com.ageha.notes', title: 'B' })

    windows.close(first.id)
    expect(stopped).not.toHaveBeenCalled()
    expect(lifecycle.isRunning('com.ageha.notes')).toBe(true)

    windows.close(second.id)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(stopped).toHaveBeenCalledWith({ appId: 'com.ageha.notes', windowId: second.id })
    expect(lifecycle.isRunning('com.ageha.notes')).toBe(false)
  })

  it('tracks multiple apps independently', () => {
    const { windows, lifecycle } = createHarness()

    windows.create({ appId: 'com.ageha.notes', title: 'A' })
    windows.create({ appId: 'com.ageha.files', title: 'B' })

    expect(lifecycle.runningAppIds()).toEqual(
      expect.arrayContaining(['com.ageha.notes', 'com.ageha.files']),
    )
  })

  it('stops listening after stop() and resumes after start()', () => {
    const { windows, lifecycle, started } = createHarness()

    lifecycle.stop()
    windows.create({ appId: 'com.ageha.notes', title: 'A' })
    expect(started).not.toHaveBeenCalled()
    expect(lifecycle.isRunning('com.ageha.notes')).toBe(false)

    lifecycle.start()
    windows.create({ appId: 'com.ageha.notes', title: 'B' })
    expect(started).toHaveBeenCalledTimes(1)
    expect(lifecycle.isRunning('com.ageha.notes')).toBe(true)
  })

  it('start() is idempotent', () => {
    const { windows, lifecycle, started } = createHarness()

    lifecycle.start()
    windows.create({ appId: 'com.ageha.notes', title: 'A' })

    expect(started).toHaveBeenCalledTimes(1)
  })
})

describe('lifecycle 计数边界（B1 审查）', () => {
  it('未计数应用收到 close 直接忽略（不发无中生有的 app.stopped）', () => {
    const bus = new EventBus<SystemEventMap>()
    const tracker = createAppLifecycleTracker(bus)
    tracker.start()
    const stopped = vi.fn()
    bus.on('app.stopped', stopped)
    bus.emit('window.closed', { appId: 'ghost.app', windowId: 'w1' })
    expect(stopped).not.toHaveBeenCalled()
    expect(tracker.isRunning('ghost.app')).toBe(false)
  })

  it('stop() 清空计数：重启后运行态从零重建', () => {
    const bus = new EventBus<SystemEventMap>()
    const tracker = createAppLifecycleTracker(bus)
    tracker.start()
    bus.emit('window.created', { appId: 'a.app', windowId: 'w1' })
    expect(tracker.isRunning('a.app')).toBe(true)
    tracker.stop()
    expect(tracker.runningAppIds()).toEqual([])
    tracker.start()
    expect(tracker.isRunning('a.app')).toBe(false)
  })
})
