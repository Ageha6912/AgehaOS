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

// 液态玻璃路径开关（vi.mock 提升，2026-10-02 裁决用例注入位移图就绪态）。
const liquidState = vi.hoisted(() => ({ map: "" }))
vi.mock('@/desktop/sidebar/liquid-glass', () => ({
  useLiquidDisplacementMap: () => liquidState.map,
}))

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
  // 网格作用域（推荐行也用应用名，避免同名撞车；§32 双栏启动器）。
  fireEvent.click(
    within(screen.getByTestId('launcher-grid')).getByRole('button', { name: appName }),
  )
}

describe('Desktop', () => {
  it('mounts the top menu bar and both rails (§19/§26/§27)', () => {
    render(<Desktop />)

    expect(screen.getByTestId('menu-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('widget-rail')).toBeInTheDocument()

    // 系统栏组（2026-10-03 裁决「单栏拉长」）：单一玻璃面板只承载左栏——
    // 上锚菜单栏下 12px、下锚 Dock 上 16px；今日列退役，flex-row-reverse
    // （两栏主轴反转）随之退役。
    const rails = screen.getByTestId('system-rails')
    for (const cls of ['surface-glass', 'rounded-xl', 'shadow-float', 'flex-col']) {
      expect(rails.classList.contains(cls), cls).toBe(true)
    }
    for (const cls of ['flex-row-reverse', 'top-1/2', '-translate-y-1/2']) {
      expect(rails.classList.contains(cls), `no ${cls}`).toBe(false)
    }
    expect(rails.className).toContain('top-[calc(var(--ag-menubar-height)+0.75rem)]')
    // 同日追加「离顶离底等距」：下沿距视口底 44px（= 上沿的菜单栏 32+12）。
    expect(rails.className).toContain('bottom-[2.75rem]')
    expect(rails.className).not.toContain('overflow')
  })

  it('applies glass-liquid + renders the displacement filter when the map is ready（2026-10-02 液态玻璃裁决）', () => {
    liquidState.map = 'data:image/png;base64,fake'
    render(<Desktop />)

    const group = screen.getByTestId('system-rails')
    expect(group.className).toContain('glass-liquid')
    expect(group.className).not.toContain('glass-raise')
    const filter = document.querySelector('svg filter#ag-liquid-rail')
    expect(filter).not.toBeNull()
    expect(filter?.querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('20')
  })

  it('falls back to glass-raise without a map（jsdom/生成失败回落）', () => {
    liquidState.map = ''
    render(<Desktop />)
    const group = screen.getByTestId('system-rails')
    expect(group.className).toContain('glass-raise')
    expect(group.className).not.toContain('glass-liquid')
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
    // 桌面图标层已移除（2026-10-01 用户裁决）：「记事」只在窗口标题栏。
    expect(screen.getAllByText('记事').length).toBe(1)

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
