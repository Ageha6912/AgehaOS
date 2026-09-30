import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { systemDynamicDesktop } from '@/services/dynamic-desktop'

import { MenuBar } from './MenuBar'

vi.mock('@/services/dynamic-desktop', () => ({
  systemDynamicDesktop: { refresh: vi.fn(async () => undefined) },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetSettingsStore()
  resetSessionStore()
  resetSearchStore()
  seedSessionForTests({
    id: 'u1',
    username: 'alice',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  })
  vi.mocked(systemDynamicDesktop.refresh).mockClear()
})

describe('MenuBar', () => {
  it('renders brand, four menus, and the migrated system status (bell/user/clock)', () => {
    render(<MenuBar />)

    expect(screen.getByText('AgehaOS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '窗口' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '帮助' })).toBeInTheDocument()
    // 系统状态自任务栏迁移（Q3 裁决）。
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /alice/ })).toBeInTheDocument()
    expect(screen.getByTestId('menu-bar-clock').textContent).toBe('10:30')
  })

  it('file menu opens the file manager and the search palette', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件管理器' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.files')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '搜索…' }))
    expect(useSearchStore.getState().open).toBe(true)
  })

  it('view menu renews the wallpaper and switches themes with a checked mark', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '视图' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '更换壁纸' }))
    expect(systemDynamicDesktop.refresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '视图' }))
    const darkItem = screen.getByRole('menuitem', { name: '深色' })
    // 当前为深色默认（ADR 24）——深色项带勾，浅色不带。
    expect(darkItem.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: '浅色' }).querySelector('svg')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '浅色' }))
    expect(useSettingsStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('window menu lists open windows, focuses on click, and minimizes all', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    expect(screen.getByRole('menuitem', { name: '文件' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: '记事' }).querySelector('svg')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '记事' }))
    // focus() 会把聚焦窗口移到数组末尾（z 序驱动）——按 appId 断言。
    const focused = useWindowStore
      .getState()
      .windows.find((win) => win.appId === 'com.ageha.notes')
    expect(focused?.focused).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '最小化全部窗口' }))
    const windows = useWindowStore.getState().windows
    expect(windows.every((win) => win.state === 'minimized')).toBe(true)
  })

  it('disables window actions when no windows are open', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    expect(screen.getByRole('menuitem', { name: '最小化全部窗口' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: '关闭全部窗口' })).toBeDisabled()
    expect(screen.queryByRole('menuitem', { name: '记事' })).not.toBeInTheDocument()
  })

  it('help menu opens settings', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '帮助' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '关于 AgehaOS' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.settings')
  })

  it('closes on Escape and on outside pointerdown, and hover-switches between menus', () => {
    render(<MenuBar />)

    const file = screen.getByRole('button', { name: '文件' })
    fireEvent.click(file)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // 悬停切换（有菜单打开时滑过即切换）。
    fireEvent.pointerEnter(screen.getByRole('button', { name: '视图' }))
    expect(screen.getByRole('menuitem', { name: '更换壁纸' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(file)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('exposes aria-expanded on menu triggers', () => {
    render(<MenuBar />)

    const view = screen.getByRole('button', { name: '视图' })
    expect(view).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(view)
    expect(view).toHaveAttribute('aria-expanded', 'true')
  })
})
