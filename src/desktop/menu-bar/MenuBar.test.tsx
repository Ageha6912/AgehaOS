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
  it('renders brand, five menus, and the migrated system status (bell/user/clock)', () => {
    render(<MenuBar />)

    expect(screen.getByText('AgehaOS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    // §32：参考图五菜单（新增「编辑」）。
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '窗口' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '帮助' })).toBeInTheDocument()
    // 系统状态自任务栏迁移（Q3 裁决）；§32 时钟含日期。
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /alice/ })).toBeInTheDocument()
    expect(screen.getByTestId('menu-bar-clock').textContent).toContain('10:30')
  })

  it('edit menu issues document-level commands (undo/redo/cut/copy/paste/selectAll)', () => {
    render(<MenuBar />)

    // jsdom 未定义 execCommand——直接桩一个可断言的实现。
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '撤销' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '全选' }))
    expect(execCommand).toHaveBeenCalledWith('undo', false, undefined)
    expect(execCommand).toHaveBeenCalledWith('selectAll', false, undefined)
    delete (document as unknown as Record<string, unknown>).execCommand
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
    const lightItem = screen.getByRole('menuitem', { name: '浅色' })
    // §32 起浅色为出厂默认（参考图明亮基线）——浅色项带勾，深色不带。
    expect(lightItem.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: '深色' }).querySelector('svg')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '深色' }))
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
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

  it('supports arrow-key traversal across triggers, items and menus (§19)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<MenuBar />)

    // 触发器左右环游（§32 五菜单：文件 → 编辑 → 视图）。
    const file = screen.getByRole('button', { name: '文件' })
    const view = screen.getByRole('button', { name: '视图' })
    file.focus()
    fireEvent.keyDown(file, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '编辑' }), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(view)
    fireEvent.keyDown(view, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '编辑' }), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(file)

    // ArrowDown 开菜单并聚焦首项；菜单内上下循环（始终驱动当前焦点元素）。
    const active = () => document.activeElement as HTMLElement
    fireEvent.keyDown(file, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开文件管理器' }))
    fireEvent.keyDown(active(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '搜索…' }))
    fireEvent.keyDown(active(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开文件管理器' }))
    fireEvent.keyDown(active(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '搜索…' }))

    // 菜单内右键头 → 切到下一个菜单（编辑，已打开）。
    fireEvent.keyDown(active(), { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: '编辑' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: '撤销' })).toBeInTheDocument()

    // Esc 回焦触发器并关闭。
    fireEvent.keyDown(active(), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑' }))
  })

  it('exposes aria-expanded on menu triggers', () => {
    render(<MenuBar />)

    const view = screen.getByRole('button', { name: '视图' })
    expect(view).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(view)
    expect(view).toHaveAttribute('aria-expanded', 'true')
  })
})
