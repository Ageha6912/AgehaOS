import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetAppStore } from '@/store/app-store'

import { Taskbar } from './Taskbar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  resetWindowStore()
  resetAppStore()
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
})
