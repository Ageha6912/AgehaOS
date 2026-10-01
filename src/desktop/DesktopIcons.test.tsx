import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STORE_CATALOG } from '@/apps/store/catalog'
import { launchApp } from '@/apps/launch'
import {
  installApp,
  registerBuiltinApps,
  resetAppStore,
  uninstallApp,
} from '@/store/app-store'

import { DesktopIcons } from './DesktopIcons'

vi.mock('@/apps/launch', () => ({ launchApp: vi.fn() }))

const launchMock = vi.mocked(launchApp)

beforeEach(() => {
  launchMock.mockReset()
  resetAppStore()
  registerBuiltinApps()
})

describe('DesktopIcons', () => {
  it('carries the token-driven hover class and the enlarged cell (§10, Slice 5)', () => {
    render(<DesktopIcons />)

    const button = screen.getByTestId('desktop-icon-com.ageha.files')
    expect(button.classList.contains('desktop-icon-button')).toBe(true)
    expect(button.classList.contains('w-20')).toBe(true)
    // 徽章升到 52：图标瓦片内联尺寸跟随。
    const tile = button.querySelector('span[class*=rounded]') as HTMLElement
    expect(tile.style.width).toBe('44px')
  })

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

  it('shows apps installed from the store on the desktop and drops them on uninstall', () => {
    const result = installApp(STORE_CATALOG[0].manifest)
    expect(result.ok).toBe(true)

    render(<DesktopIcons />)

    // 内置 7 个 + 安装的时钟，时钟排在内置之后。
    expect(screen.getAllByRole('button')).toHaveLength(8)
    const clockIcon = screen.getByRole('button', { name: '时钟' })
    expect(clockIcon).toHaveAttribute('data-testid', 'desktop-icon-com.ageha.samples.clock')

    // 卸载 → 桌面图标随之消失（zustand 写入需 act 包裹才会刷新 RTL）。
    act(() => {
      uninstallApp('com.ageha.samples.clock')
    })
    expect(screen.queryByRole('button', { name: '时钟' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(7)
  })
})
