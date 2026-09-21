import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBootStore } from '@/store/boot-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { Desktop } from './Desktop'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  useBootStore.setState(useBootStore.getInitialState())
  resetWindowStore()
})

describe('Desktop', () => {
  it('opens an app window from the launcher and closes it again', () => {
    render(<Desktop />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.click(screen.getByRole('button', { name: /记事/ }))

    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(screen.getAllByText('记事').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))

    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(screen.queryByText('记事')).not.toBeInTheDocument()
  })

  it('stacks a second window above the first and focuses on click', () => {
    render(<Desktop />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.click(screen.getByRole('button', { name: /记事/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.click(screen.getByRole('button', { name: /文件/ }))

    let windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(2)
    expect(windows.find((win) => win.appId === 'notes')?.focused).toBe(false)
    expect(windows.find((win) => win.appId === 'files')?.focused).toBe(true)

    fireEvent.pointerDown(screen.getByRole('region', { name: '记事' }))

    windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.appId === 'notes')?.focused).toBe(true)
    expect(windows.find((win) => win.appId === 'files')?.focused).toBe(false)
  })
})
