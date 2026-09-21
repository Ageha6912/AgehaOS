import { describe, it, expect } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'

import {
  WindowManager,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from './window-manager'

const VIEWPORT = { width: 1920, height: 1040 }

function createManager(events?: (keyof SystemEventMap)[]) {
  const bus = new EventBus<SystemEventMap>()
  const seen: string[] = []
  if (events) {
    for (const name of events) {
      bus.on(name, () => seen.push(name))
    }
  }
  let counter = 0
  const manager = new WindowManager(bus, () => `win-${++counter}`)
  return { manager, seen, stateOf: (id: string) => manager.get(id)! }
}

describe('WindowManager.create', () => {
  it('applies defaults from the PRD window model', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'notes', title: 'Notes' })

    expect(win.id).toBe('win-1')
    expect(win.width).toBe(DEFAULT_WINDOW_WIDTH)
    expect(win.height).toBe(DEFAULT_WINDOW_HEIGHT)
    expect(win.state).toBe('normal')
    expect(win.focused).toBe(true)
    expect(win.zIndex).toBe(1)
    expect(win.resizable).toBe(true)
    expect(win.closable).toBe(true)
    expect(win.minWidth).toBe(MIN_WINDOW_WIDTH)
    expect(win.minHeight).toBe(MIN_WINDOW_HEIGHT)
    expect(win.restoreBounds).toBeNull()
  })

  it('unfocuses the previously focused window', () => {
    const { manager, stateOf } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })

    expect(stateOf(first.id).focused).toBe(false)
    expect(stateOf(second.id).focused).toBe(true)
    expect(stateOf(second.id).zIndex).toBeGreaterThan(stateOf(first.id).zIndex)
  })

  it('cascades default positions so windows do not overlap exactly', () => {
    const { manager } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })

    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('honors explicit geometry and enforces minimum size', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({
      appId: 'a',
      title: 'A',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })

    expect(win.x).toBe(10)
    expect(win.y).toBe(20)
    expect(stateOf(win.id).width).toBe(MIN_WINDOW_WIDTH)
    expect(stateOf(win.id).height).toBe(MIN_WINDOW_HEIGHT)
  })

  it('emits window.created followed by window.focused', () => {
    const { manager, seen } = createManager(['window.created', 'window.focused'])

    manager.create({ appId: 'a', title: 'A' })

    expect(seen).toEqual(['window.created', 'window.focused'])
  })
})

describe('WindowManager.focus', () => {
  it('raises the focused window above all others', () => {
    const { manager, stateOf } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.focus(first.id)

    expect(stateOf(first.id).focused).toBe(true)
    expect(stateOf(second.id).focused).toBe(false)
    expect(stateOf(first.id).zIndex).toBeGreaterThan(stateOf(second.id).zIndex)
  })

  it('emits window.focused', () => {
    const { manager, seen } = createManager(['window.focused'])

    const win = manager.create({ appId: 'a', title: 'A' })
    seen.length = 0
    manager.focus(win.id)

    expect(seen).toEqual(['window.focused'])
  })

  it('refuses to focus unknown or minimized windows', () => {
    const { manager, seen } = createManager(['window.focused'])

    expect(manager.focus('missing')).toBe(false)

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    expect(manager.focus(win.id)).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('WindowManager.minimize', () => {
  it('marks the window minimized and unfocused', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('minimized')
    expect(state.focused).toBe(false)
    expect(manager.visibleList()).toHaveLength(0)
  })

  it('focuses the topmost remaining visible window', () => {
    const { manager } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.focus(second.id)

    manager.minimize(second.id)

    expect(manager.get(first.id)?.focused).toBe(true)
  })

  it('emits window.minimized and the refocus event', () => {
    const { manager, seen } = createManager(['window.minimized', 'window.focused'])

    manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    seen.length = 0

    manager.minimize(second.id)

    expect(seen).toEqual(['window.minimized', 'window.focused'])
  })

  it('is a no-op when already minimized', () => {
    const { manager, seen } = createManager(['window.minimized'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    expect(manager.minimize(win.id)).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('WindowManager.maximize', () => {
  it('stores restore bounds and switches state', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20 })
    manager.maximize(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('maximized')
    expect(state.restoreBounds).toEqual({
      x: 10,
      y: 20,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    })
    expect(state.focused).toBe(true)
  })

  it('emits window.maximized once and ignores repeats', () => {
    const { manager, seen } = createManager(['window.maximized'])

    const win = manager.create({ appId: 'a', title: 'A' })
    seen.length = 0

    expect(manager.maximize(win.id)).toBe(true)
    expect(manager.maximize(win.id)).toBe(false)
    expect(seen).toEqual(['window.maximized'])
  })

  it('maximizes a minimized window without overwriting restore bounds', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20 })
    manager.maximize(win.id)
    manager.minimize(win.id)
    manager.maximize(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('maximized')
    expect(state.restoreBounds).toEqual({
      x: 10,
      y: 20,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    })
  })
})

describe('WindowManager.restore', () => {
  it('returns a maximized window to its previous geometry', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20, width: 500, height: 400 })
    manager.maximize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('normal')
    expect(state.x).toBe(10)
    expect(state.y).toBe(20)
    expect(state.width).toBe(500)
    expect(state.height).toBe(400)
    expect(state.restoreBounds).toBeNull()
    expect(state.focused).toBe(true)
  })

  it('brings a minimized window back as maximized when it was maximized before', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.maximize(win.id)
    manager.minimize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('maximized')
    expect(state.focused).toBe(true)
  })

  it('brings a minimized normal window back as normal', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('normal')
    expect(state.restoreBounds).toBeNull()
  })

  it('emits window.restored', () => {
    const { manager, seen } = createManager(['window.restored'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    manager.restore(win.id)

    expect(seen).toEqual(['window.restored'])
  })

  it('is a no-op for a normal window', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })

    expect(manager.restore(win.id)).toBe(false)
  })
})

describe('WindowManager.close', () => {
  it('removes the window and focuses the next topmost visible one', () => {
    const { manager, seen } = createManager(['window.closed', 'window.focused'])

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    seen.length = 0

    expect(manager.close(second.id)).toBe(true)

    expect(manager.get(second.id)).toBeNull()
    expect(manager.count).toBe(1)
    expect(seen).toEqual(['window.closed', 'window.focused'])
    expect(manager.get(first.id)?.focused).toBe(true)
  })

  it('returns false for unknown ids', () => {
    const { manager, seen } = createManager(['window.closed'])

    expect(manager.close('missing')).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('WindowManager.move', () => {
  it('moves a normal window freely without a viewport', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.move(win.id, -500, -10)

    const state = stateOf(win.id)
    expect(state.x).toBe(-500)
    expect(state.y).toBe(0)
  })

  it('clamps so the window keeps a visible edge inside the viewport', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })

    manager.move(win.id, -99999, -99999, VIEWPORT)
    expect(stateOf(win.id).x).toBe(80 - DEFAULT_WINDOW_WIDTH)
    expect(stateOf(win.id).y).toBe(0)

    manager.move(win.id, 99999, 99999, VIEWPORT)
    expect(stateOf(win.id).x).toBe(VIEWPORT.width - 80)
    expect(stateOf(win.id).y).toBe(VIEWPORT.height - 80)
  })

  it('rejects moving maximized or minimized windows', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 50, y: 50 })
    manager.maximize(win.id)

    expect(manager.move(win.id, 100, 100, VIEWPORT)).toBe(false)
    expect(stateOf(win.id).x).toBe(50)
  })
})

describe('WindowManager.resize', () => {
  it('resizes a normal window within viewport bounds', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100 })

    expect(manager.resize(win.id, 700, 500, VIEWPORT)).toBe(true)
    expect(stateOf(win.id).width).toBe(700)
    expect(stateOf(win.id).height).toBe(500)
  })

  it('enforces the configured minimum size', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', minWidth: 400, minHeight: 300 })

    manager.resize(win.id, 10, 10)

    expect(stateOf(win.id).width).toBe(400)
    expect(stateOf(win.id).height).toBe(300)
  })

  it('caps the window at the viewport edge it grew towards', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100 })

    manager.resize(win.id, 99999, 99999, VIEWPORT)

    expect(stateOf(win.id).width).toBe(VIEWPORT.width - 100)
    expect(stateOf(win.id).height).toBe(VIEWPORT.height - 100)
  })

  it('rejects non-resizable or non-normal windows', () => {
    const { manager, stateOf } = createManager()

    const fixed = manager.create({ appId: 'a', title: 'A', resizable: false })
    expect(manager.resize(fixed.id, 800, 600)).toBe(false)
    expect(stateOf(fixed.id).width).toBe(DEFAULT_WINDOW_WIDTH)

    const win = manager.create({ appId: 'b', title: 'B' })
    manager.minimize(win.id)
    expect(manager.resize(win.id, 800, 600)).toBe(false)
  })
})

describe('WindowManager snapshots', () => {
  it('returns copies so callers cannot mutate internal state', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    win.title = 'mutated'
    win.state = 'minimized'

    expect(manager.get(win.id)?.title).toBe('A')
    expect(manager.get(win.id)?.state).toBe('normal')
  })

  it('lists windows in z-order', () => {
    const { manager } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.focus(first.id)

    expect(manager.list().map((w) => w.id)).toEqual([second.id, first.id])
  })
})
