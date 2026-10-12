import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { cycleWindows, useGlobalShortcuts } from './use-global-shortcuts'

function Harness(): null {
  useGlobalShortcuts()
  return null
}

beforeEach(() => {
  resetSearchStore()
  resetWindowStore()
  resetSpaceStore()
})

describe('global shortcuts (PRD §15/§26)', () => {
  it('toggles the search palette with Ctrl+K and closes with Escape', () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(useSearchStore.getState().open).toBe(true)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, metaKey: false })
    expect(useSearchStore.getState().open).toBe(false)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('cycles focus across visible windows with Alt+W', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    // 两个窗口都是 normal；当前焦点在最后打开的 second 上。
    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
  })

  it('ignores Alt+W with fewer than two visible windows', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })
})

describe('cycleWindows', () => {
  it('skips minimized windows', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const third = useWindowStore.getState().open({ appId: 'com.ageha.settings', title: '设置' })
    useWindowStore.getState().minimize(second)

    cycleWindows()

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(windows.find((win) => win.id === third)?.focused).toBe(false)
  })

  it('只在当前 Space 的可见窗口间轮转（W2，审计 .tmp/spaces-audit.md §5 决定 4）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const other = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件', spaceId: 'space-other' })
    const third = useWindowStore.getState().open({ appId: 'com.ageha.settings', title: '设置' })
    expect(useSpaceStore.getState().activeSpaceId).not.toBe('space-other')

    cycleWindows()

    let windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === first)?.focused).toBe(true)
    // 其他 Space 的窗口既不参与轮转也不被聚焦。
    expect(windows.find((win) => win.id === other)?.focused).toBe(false)

    cycleWindows()

    windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === third)?.focused).toBe(true)
    expect(windows.find((win) => win.id === other)?.focused).toBe(false)
  })
})
