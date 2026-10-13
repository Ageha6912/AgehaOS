import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { resetShortcutRegistry } from './shortcuts/registry'
import { cycleWindows, useGlobalShortcuts } from './use-global-shortcuts'

function Harness(): null {
  useGlobalShortcuts()
  return null
}

beforeEach(() => {
  resetShortcutRegistry()
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

describe('space 切换快捷键（W3，审计 .tmp/spaces-audit.md §6）', () => {
  it('Ctrl+Alt+→ 切到下一个 Space、Ctrl+Alt+← 切回（按 index 轮转）', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(second)

    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('末位按 → 回绕到首位', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useSpaceStore.getState().switchSpace(second)
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('单 Space 时切换快捷键 no-op；普通方向键（无 Ctrl+Alt）不触发切换', () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(useSpaceStore.getState().spaces).toHaveLength(1)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true, shiftKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
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
