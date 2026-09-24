import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
import { useBootStore } from '@/store/boot-store'
import { resetAppStore } from '@/store/app-store'
import {
  resetDynamicDesktopStore,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { Desktop } from './Desktop'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  useBootStore.setState(useBootStore.getInitialState())
  resetWindowStore()
  resetAppStore()
  resetDynamicDesktopStore()
})

function launchFromStartMenu(appName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /开始/ }))
  // <menu> exposes the ARIA role "list".
  fireEvent.click(
    within(screen.getByRole('list', { name: /开始/ })).getByRole('button', { name: appName }),
  )
}

describe('Desktop', () => {
  it('opens an app window from the launcher and closes it again', () => {
    render(<Desktop />)

    launchFromStartMenu(/记事/)

    expect(useWindowStore.getState().windows).toHaveLength(1)
    // 任务栏项现在只显示图标（悬停预览里才有标题），标题仅出现在窗口标题栏。
    expect(screen.getAllByText('记事').length).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))

    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(screen.queryByText('记事')).not.toBeInTheDocument()
  })

  it('stacks a second window above the first and focuses on click', () => {
    render(<Desktop />)

    launchFromStartMenu(/记事/)
    launchFromStartMenu(/文件/)

    let windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(2)
    expect(windows.find((win) => win.appId === 'com.ageha.notes')?.focused).toBe(false)
    expect(windows.find((win) => win.appId === 'com.ageha.files')?.focused).toBe(true)

    fireEvent.pointerDown(screen.getByRole('region', { name: '记事' }))

    windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.appId === 'com.ageha.notes')?.focused).toBe(true)
    expect(windows.find((win) => win.appId === 'com.ageha.files')?.focused).toBe(false)
  })
})

describe('Desktop × dynamic wallpaper (验收 ⑨)', () => {
  const wallpaperPlan = buildWallpaperPlan({
    seed: 'desktop-seed',
    style: 'fluid-gradient',
    paletteId: 'midnight-ink',
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    zone: 'converge',
    reason: { signals: [], palette: 'midnight-ink', motif: 'fluid-gradient' },
  })

  function enableDynamicDesktop() {
    useDynamicDesktopStore.setState({
      currentPlan: wallpaperPlan,
      prefs: { enabled: true, randomness: 40, hideBadge: false, pinned: null, blockedStyles: [], llmEnhance: false },
    })
  }

  it('keeps the v0.1 desktop untouched when the dynamic desktop is off', () => {
    render(<Desktop />)

    expect(screen.queryByTestId('wallpaper-layer')).toBeNull()
    // v0.1 行为不变：启动器照常工作
    launchFromStartMenu(/记事/)
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('mounts the wallpaper layer when enabled with a generated plan', () => {
    enableDynamicDesktop()
    render(<Desktop />)

    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge')).toBeInTheDocument()
  })

  it('unmounts the wallpaper layer again when the user switches the feature off', () => {
    enableDynamicDesktop()
    const { rerender } = render(<Desktop />)
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()

    useDynamicDesktopStore.getState().setEnabled(false)
    rerender(<Desktop />)
    expect(screen.queryByTestId('wallpaper-layer')).toBeNull()
  })
})
