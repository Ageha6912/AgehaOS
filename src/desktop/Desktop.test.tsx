import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
import { useBootStore } from '@/store/boot-store'
import { installApp, resetAppStore } from '@/store/app-store'
import { STORE_CATALOG } from '@/apps/store/catalog'
import {
  resetDynamicDesktopStore,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetUsageStore } from '@/store/usage-store'

import { Desktop } from './Desktop'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  // 清掉安装持久化/轮换记录等跨用例泄漏（resetAppStore 会从 localStorage 恢复）。
  localStorage.clear()
  useBootStore.setState(useBootStore.getInitialState())
  resetWindowStore()
  resetAppStore()
  resetDynamicDesktopStore()
  resetUsageStore()
})

function launchFromStartMenu(appName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /开始/ }))
  // <menu> exposes the ARIA role "list".
  fireEvent.click(
    within(screen.getByRole('list', { name: /开始/ })).getByRole('button', { name: appName }),
  )
}

describe('Desktop', () => {
  it('mounts the top menu bar and both rails (§19/§26/§27)', () => {
    render(<Desktop />)

    expect(screen.getByTestId('menu-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('widget-rail')).toBeInTheDocument()
  })

  it('auto-opens the dynamic panel once per desktop session, docked to the right', () => {
    const { rerender } = render(<Desktop />)

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe('com.ageha.dynamic.panel')
    // 面板停靠桌面右侧（避开左侧图标列），fallback 最小 8px。
    expect(windows[0]?.x).toBeGreaterThanOrEqual(8)

    // StrictMode/重渲染不重复开窗。
    rerender(<Desktop />)
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('auto-opens a random installed game next to the panel on entry', () => {
    const gameEntry = STORE_CATALOG.find(
      (entry) => entry.manifest.id === 'com.ageha.games.snake',
    )
    expect(gameEntry).toBeDefined()
    const installed = installApp(gameEntry!.manifest)
    expect(installed.ok).toBe(true)

    render(<Desktop />)

    // 动态面板 + 轮换小游戏。
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(2)
    expect(windows[1]?.appId).toBe('com.ageha.games.snake')
    // 游戏窗口水平居中。
    expect(windows[1]?.x).toBeGreaterThan(0)
  })

  it('opens an app window from the launcher and closes it again', () => {
    render(<Desktop />)

    launchFromStartMenu(/记事/)

    // 自动打开的动态面板 + 记事，共两个窗口。
    expect(useWindowStore.getState().windows).toHaveLength(2)
    // 桌面图标层已移除（2026-10-01 用户裁决）：「记事」只在窗口标题栏。
    expect(screen.getAllByText('记事').length).toBe(1)

    // 关闭记事窗口（按区域限定，避开动态面板的关闭按钮）。
    fireEvent.click(
      within(screen.getByRole('region', { name: '记事' })).getByRole('button', {
        name: '关闭窗口',
      }),
    )

    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('stacks a second window above the first and focuses on click', () => {
    render(<Desktop />)

    launchFromStartMenu(/记事/)
    launchFromStartMenu(/文件/)

    // 自动面板 + 记事 + 文件。
    let windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(3)
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
    // v0.1 行为不变：启动器照常工作（自动面板之外多出一个窗口）。
    launchFromStartMenu(/记事/)
    expect(useWindowStore.getState().windows).toHaveLength(2)
  })

  it('mounts the wallpaper layer when enabled with a generated plan', () => {
    enableDynamicDesktop()
    render(<Desktop />)

    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    // 2026-09-27 裁决：生成式壁纸不显示 AI 徽标。
    expect(screen.queryByTestId('ai-badge')).toBeNull()
  })

  it('unmounts the wallpaper layer again when the user switches the feature off', () => {
    enableDynamicDesktop()
    const { rerender } = render(<Desktop />)
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()

    useDynamicDesktopStore.getState().setEnabled(false)
    rerender(<Desktop />)
    expect(screen.queryByTestId('wallpaper-layer')).toBeNull()
  })

  it('mounts the atmosphere layer over wallpaper and fallback canvas alike (§18)', () => {
    // 壁纸关闭：氛围层落在 surface-canvas 渐变上。
    const { rerender } = render(<Desktop />)
    expect(screen.getByTestId('atmosphere-layer')).toBeInTheDocument()

    // 壁纸开启：氛围层照常渲染且不进可达树、不截胡指针。
    enableDynamicDesktop()
    rerender(<Desktop />)
    const layer = screen.getByTestId('atmosphere-layer')
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.classList.contains('pointer-events-none')).toBe(true)
  })
})
