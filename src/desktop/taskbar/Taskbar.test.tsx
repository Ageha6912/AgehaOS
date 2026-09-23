import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetAppStore } from '@/store/app-store'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

import { Taskbar } from './Taskbar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  resetWindowStore()
  resetAppStore()
  resetDynamicDesktopStore()
})

describe('Taskbar', () => {
  it('shows the clock for the current time', () => {
    render(<Taskbar />)

    expect(screen.getByText('10:30')).toBeInTheDocument()
  })

  it('launches an app from the start menu', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.click(screen.getByRole('button', { name: /记事/ }))

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe('com.ageha.notes')
    expect(windows[0]?.title).toBe('记事')
    expect(windows[0]?.width).toBe(720)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('minimizes the focused window and restores it from the taskbar', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    fireEvent.click(screen.getByTitle('记事'))
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')

    fireEvent.click(screen.getByTitle('记事'))
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })

  it('focuses an unfocused window instead of minimizing it', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Taskbar />)

    fireEvent.click(screen.getByTitle('记事'))

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.appId === 'com.ageha.notes')?.focused).toBe(true)
    expect(windows.find((win) => win.appId === 'com.ageha.files')?.focused).toBe(false)
  })

  it('renders adopted layout groups in the start menu and can launch from them', () => {
    useDynamicDesktopStore.getState().applyLayout({
      layoutId: 'layout-taskbar-test',
      tier: 'double',
      groups: [{ nameKey: 'tools', appIds: ['com.ageha.calculator', 'com.ageha.dynamic.panel'] }],
    })
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    // 采纳后的菜单：档位标识 + 分组标题 + 系统组（永不随机清单仍在顶部）。
    expect(screen.getByTestId('launcher-layout-double')).toBeInTheDocument()
    expect(screen.getByText('工具')).toBeInTheDocument()
    expect(screen.getByText('系统')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument()

    // 从分组内启动应用照常工作。
    fireEvent.click(screen.getByRole('button', { name: /计算器/ }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.calculator')
  })

  it('keeps the flat start menu when no layout is adopted', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    expect(screen.queryByText('工具')).not.toBeInTheDocument()
    expect(screen.queryByText('系统')).not.toBeInTheDocument()
  })
})
