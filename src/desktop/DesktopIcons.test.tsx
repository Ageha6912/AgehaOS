import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { launchApp } from '@/apps/launch'

import { DesktopIcons } from './DesktopIcons'

vi.mock('@/apps/launch', () => ({ launchApp: vi.fn() }))

const launchMock = vi.mocked(launchApp)

beforeEach(() => {
  launchMock.mockReset()
})

describe('DesktopIcons', () => {
  it('pins every built-in app with its localized name', () => {
    render(<DesktopIcons />)

    const names = ['文件', '记事', '终端', '应用商店', '计算器', '动态面板', '设置']
    for (const name of names) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button')).toHaveLength(names.length)
  })

  it('selects on click and moves the selection to another icon', () => {
    render(<DesktopIcons />)

    const files = screen.getByRole('button', { name: '文件' })
    const notes = screen.getByRole('button', { name: '记事' })

    fireEvent.click(files)
    expect(files).toHaveAttribute('aria-pressed', 'true')
    expect(notes).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(notes)
    expect(notes).toHaveAttribute('aria-pressed', 'true')
    expect(files).toHaveAttribute('aria-pressed', 'false')
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('launches the app on double-click and keeps it selected', () => {
    render(<DesktopIcons />)

    const files = screen.getByRole('button', { name: '文件' })
    fireEvent.doubleClick(files)

    expect(launchMock).toHaveBeenCalledWith('com.ageha.files')
    expect(files).toHaveAttribute('aria-pressed', 'true')
  })

  it('launches with the keyboard (Enter)', () => {
    render(<DesktopIcons />)

    fireEvent.keyDown(screen.getByRole('button', { name: '终端' }), { key: 'Enter' })
    expect(launchMock).toHaveBeenCalledWith('com.ageha.terminal')
  })

  it('clears the selection when clicking outside the icons', () => {
    render(<DesktopIcons />)

    const files = screen.getByRole('button', { name: '文件' })
    fireEvent.click(files)
    expect(files).toHaveAttribute('aria-pressed', 'true')

    fireEvent.pointerDown(document.body)
    expect(files).toHaveAttribute('aria-pressed', 'false')
  })
})
