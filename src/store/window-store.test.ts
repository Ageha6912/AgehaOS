import { beforeEach, describe, expect, it } from 'vitest'

import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@/core/window'

import { resetWindowStore, useWindowStore } from './window-store'

beforeEach(() => {
  resetWindowStore()
})

describe('useWindowStore', () => {
  it('opens a window and syncs it into state', () => {
    const id = useWindowStore.getState().open({ appId: 'notes', title: 'Notes' })

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.id).toBe(id)
    expect(windows[0]?.focused).toBe(true)
  })

  it('closes a window and removes it from state', () => {
    const { open, close } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    close(id)

    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('toggles maximize and restore through toggleMaximize', () => {
    const { open, toggleMaximize } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes', x: 10, y: 10 })

    toggleMaximize(id)
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')

    toggleMaximize(id)
    const restored = useWindowStore.getState().windows[0]
    expect(restored?.state).toBe('normal')
    expect(restored?.x).toBe(10)
    expect(restored?.y).toBe(10)
  })

  it('delegates move with viewport clamping to the engine', () => {
    const { open, move } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    move(id, 99999, 99999, { width: 1920, height: 1040 })

    const win = useWindowStore.getState().windows[0]
    expect(win?.x).toBe(1920 - 80)
    expect(win?.y).toBe(1040 - 80)
  })

  it('keeps minimized windows mounted in state but out of the visible list', () => {
    const { open, minimize } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    minimize(id)

    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
    expect(useWindowStore.getState().windows[0]?.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(useWindowStore.getState().windows[0]?.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
  })
})
