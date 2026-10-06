import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
import { useBootStore } from '@/store/boot-store'
import { installApp, resetAppStore } from '@/store/app-store'
import { resetLauncherStore } from '@/store/launcher-store'
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
  resetLauncherStore()
})

function launchFromStartMenu(appName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /开始/ }))
  // 网格作用域（推荐行也用应用名，避免同名撞车；§32 双栏启动器）。
  fireEvent.click(
    within(screen.getByTestId('launcher-grid')).getByRole('button', { name: appName }),
  )
}

describe('Desktop', () => {
  it('mounts the top menu bar and the two left islands (§19/§26/§34 双岛)', () => {
    render(<Desktop />)

    expect(screen.getByTestId('menu-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('widget-rail')).toBeInTheDocument()

    // 双岛口径（§34 参考图）：组容器退化为纯定位带——顶锚菜单栏下 12px、
    // Dock 上方 12px 收尾，pointer-events-none（岛间缝隙穿透桌面）；
    // 玻璃/圆角/投影各自在岛上。
    const rails = screen.getByTestId('system-rails')
    for (const cls of ['left-4', 'pointer-events-none', 'items-stretch', 'gap-3.5']) {
      expect(rails.classList.contains(cls), cls).toBe(true)
    }
    expect(rails.className).toContain('top-[calc(var(--ag-menubar-height)+12px)]')
    expect(rails.className).toContain('bottom-[calc(var(--ag-dock-height)+var(--ag-dock-gap)+12px)]')
    for (const cls of ['top-1/2', '-translate-y-1/2', 'surface-glass', 'rounded-xl', 'shadow-float']) {
      expect(rails.classList.contains(cls), `no ${cls}`).toBe(false)
    }
    expect(rails.className).not.toContain('overflow')
    // 岛一（窄轨）2026-10-06 再裁决：毛玻璃 glass-raise 原档回归（裸浮试验
    // 回撤）；交互面（pointer-events-auto）与几何（h-full）保留。
    const rail = screen.getByTestId('sidebar')
    for (const cls of ['desktop-chrome', 'surface-glass', 'glass-raise', 'rounded-xl', 'shadow-float', 'border', 'pointer-events-auto', 'h-full']) {
      expect(rail.classList.contains(cls), `rail ${cls}`).toBe(true)
    }
    expect(screen.queryByTestId('workspace-panel-island')).toBeNull()
  })

  it('keeps the rail on the glass-raise tier; panel wears the top-clear gradient veil（2026-10-06 再裁决）', () => {
    render(<Desktop />)

    // 窄轨毛玻璃回归（glass-raise 原档）；面板 = 顶透下白渐变 veil
    // （2%→12% 右栏卡片白）+ 全幅磨砂带同向渐隐，surface 自身无 backdrop；
    // 顶栏保持裸浮（本裁决未涉及）；液态折射滤镜不再渲染。
    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const rail = screen.getByTestId('sidebar')
    expect(rail.classList.contains('surface-glass')).toBe(true)
    expect(rail.classList.contains('glass-raise')).toBe(true)
    const surface = screen.getByTestId('workspace-panel-surface')
    expect(surface.className).toContain('glass-veil')
    expect(surface.className).not.toContain('glass-liquid')
    expect(surface.classList.contains('glass-hint')).toBe(false)
    expect(document.querySelector('svg filter#ag-liquid-rail')).toBeNull()
  })

  it('exposes landmarks and a DOM order that matches the visual order (UI review P2-7)', () => {
    render(<Desktop />)

    expect(screen.getByRole('heading', { level: 1, name: 'AgehaOS 桌面' })).toBeInTheDocument()
    expect(screen.getByRole('main', { name: '窗口' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '系统导航' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '程序坞' })).toBeInTheDocument()

    // Tab 序：菜单栏 → 左栏 → 窗口区 → 右栏 → Dock。
    const order = [
      screen.getByTestId('menu-bar'),
      screen.getByTestId('sidebar'),
      screen.getByRole('main', { name: '窗口' }),
      screen.getByTestId('widget-rail'),
      screen.getByRole('navigation', { name: '程序坞' }),
    ]
    for (let index = 1; index < order.length; index += 1) {
      const relation = order[index - 1]!.compareDocumentPosition(order[index]!)
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // 菜单栏层级略高于其余 chrome：下拉不被随后渲染的左右栏盖住。
    expect(screen.getByTestId('menu-bar').classList.contains('z-[41]')).toBe(true)
  })

  it('opens NOTHING automatically at desktop entry（2026-10-02 用户裁决：零自动开窗）', () => {
    const { rerender } = render(<Desktop />)

    // 桌面回归纯壁纸 + 品牌层：动态面板与小游戏都不再自动打开。
    expect(useWindowStore.getState().windows).toHaveLength(0)

    // StrictMode/重渲染同样零开窗。
    rerender(<Desktop />)
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('does not auto-open installed games either（轮换自动开窗已退役）', () => {
    const gameEntry = STORE_CATALOG.find(
      (entry) => entry.manifest.id === 'com.ageha.games.snake',
    )
    expect(gameEntry).toBeDefined()
    const installed = installApp(gameEntry!.manifest)
    expect(installed.ok).toBe(true)

    render(<Desktop />)

    // 已安装游戏也不再自动开窗；游戏仍可经商店/启动器手动启动。
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('opens an app window from the launcher and closes it again', () => {
    render(<Desktop />)

    launchFromStartMenu(/记事/)

    // 零自动开窗后：启动器开「记事」= 唯一窗口。
    expect(useWindowStore.getState().windows).toHaveLength(1)
    // 桌面图标层已移除（2026-10-01 用户裁决）：「记事」在窗口层只在标题栏
    // （主地标作用域内唯一）。
    expect(within(screen.getByRole('main', { name: '窗口' })).getAllByText('记事').length).toBe(1)

    // 关闭记事窗口。
    fireEvent.click(
      within(screen.getByRole('region', { name: '记事' })).getByRole('button', {
        name: '关闭窗口',
      }),
    )

    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('stacks a second window above the first and focuses on click', () => {
    render(<Desktop />)

    launchFromStartMenu(/记事/)
    launchFromStartMenu(/文件/)

    // 记事 + 文件。
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

  it('keeps the photo base wallpaper with no field surface when the dynamic desktop is off (§32)', () => {
    render(<Desktop />)

    // §32：壁纸层常驻（照片基底），关动态桌面 = 无场渲染面。
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(screen.getByTestId('wallpaper-surface-photo')).toBeInTheDocument()
    expect(screen.queryByTestId('wallpaper-surface-canvas')).toBeNull()
    expect(screen.queryByTestId('wallpaper-surface-css')).toBeNull()
    // 启动器照常工作（零自动开窗：记事即唯一窗口）。
    launchFromStartMenu(/记事/)
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('mounts the wallpaper layer when enabled with a generated plan', () => {
    enableDynamicDesktop()
    render(<Desktop />)

    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    // 2026-09-27 裁决：生成式壁纸不显示 AI 徽标。
    expect(screen.queryByTestId('ai-badge')).toBeNull()
  })

  it('drops the field surface back to the photo base when the user switches the feature off (§32)', () => {
    enableDynamicDesktop()
    const { rerender } = render(<Desktop />)
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()

    useDynamicDesktopStore.getState().setEnabled(false)
    rerender(<Desktop />)
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(screen.queryByTestId('wallpaper-surface-canvas')).toBeNull()
    expect(screen.queryByTestId('wallpaper-surface-css')).toBeNull()
    // 照片基底回归。
    expect(screen.getByTestId('wallpaper-surface-photo')).toBeInTheDocument()
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
