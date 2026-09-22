import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { WindowLayer } from './WindowLayer'

beforeEach(() => {
  resetWindowStore()
})

describe('WindowFrame (via WindowLayer)', () => {
  it('renders the title bar and app body', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100 })

    render(<WindowLayer />)

    expect(screen.getByRole('region', { name: '记事' })).toBeInTheDocument()
    expect(screen.getByText('选择或新建一条笔记')).toBeInTheDocument()
  })

  it('closes the window via the close button', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))

    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('minimizes the window via the minimize button', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)

    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))

    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
  })

  it('toggles maximize via the maximize button and double-click on the title bar', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100 })

    render(<WindowLayer />)

    fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')

    fireEvent.click(screen.getByRole('button', { name: '还原窗口' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
    expect(useWindowStore.getState().windows[0]?.x).toBe(100)

    fireEvent.doubleClick(screen.getByText('记事'))
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')
  })

  it('focuses the window on pointer down', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })

    render(<WindowLayer />)
    expect(
      useWindowStore.getState().windows.find((win) => win.appId === 'com.ageha.notes')?.focused,
    ).toBe(false)

    fireEvent.pointerDown(screen.getByRole('region', { name: '记事' }))

    expect(
      useWindowStore.getState().windows.find((win) => win.appId === 'com.ageha.notes')?.focused,
    ).toBe(true)
  })

  it('keeps a minimized window mounted but hidden', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)
    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))

    const region = screen.getByRole('region', { name: '记事' })
    expect(region).toBeInTheDocument()
    expect(region.className).toContain('hidden')
  })

  it('hides the maximize button for non-resizable windows', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', resizable: false })

    render(<WindowLayer />)

    expect(screen.queryByRole('button', { name: '最大化窗口' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最小化窗口' })).toBeInTheDocument()
  })

  it('renders a fallback body when the app is not registered', () => {
    useWindowStore.getState().open({ appId: 'ghost', title: 'Ghost' })

    render(<WindowLayer />)

    expect(screen.getByText('未找到该应用，窗口即将关闭。')).toBeInTheDocument()
  })
})
