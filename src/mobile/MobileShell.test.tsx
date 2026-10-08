import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MobileShell } from './MobileShell'
import { resetAppStore } from '@/store/app-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

/**
 * M0-4 Safe Area + M1-1 + M1-2：移动 Shell 三段骨架的 DOM 契约。safe-area
 * 的几何语义（env(safe-area-inset-*) 与 max() 保底高度）jsdom 算不了 env，
 * 几何探针归 E2E（e2e/mobile-shell.spec.ts）；这里钉住结构与类名接线，
 * 防止后续切片静默拆掉占位带/滚动容器。M1-1 起状态栏填充真实状态条（不再
 * aria-hidden 空占位）、内容区挂 Home 视图；M1-2 起根元素反射
 * mobile-nav-store 当前位置（data-nav-view / data-nav-app-id，E2E 断言口）。
 */
describe('MobileShell', () => {
  afterEach(() => {
    resetSessionStore()
    resetMobileNavStore()
  })

  it('renders the three-slot skeleton with safe-area band classes (M0-4)', () => {
    const { container } = render(<MobileShell />)

    const shell = screen.getByTestId('mobile-shell')
    expect(shell).toHaveAttribute('data-shell', 'mobile')
    expect(shell).toHaveClass('mobile-shell')

    const statusbar = screen.getByTestId('mobile-statusbar-slot')
    const content = screen.getByTestId('mobile-content-slot')
    const dock = screen.getByTestId('mobile-dock-slot')

    // 两条占位带挂 max() 高度类（index.css 移动段），收缩禁止交给 shrink-0。
    expect(statusbar).toHaveClass('mobile-statusbar-slot')
    expect(statusbar).toHaveClass('shrink-0')
    expect(dock).toHaveClass('mobile-dock-slot')
    expect(dock).toHaveClass('shrink-0')

    // DOM 序 = 视觉序（DESIGN.md §0.6）：状态栏 → 内容 → Dock。
    expect(
      statusbar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      content.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // M1-1：状态栏填充真实状态条（能力不可用的 jsdom 里时钟恒在场；
    // 会话缺席时用户名也隐藏——「不可用即隐藏」口径对用户名同样成立）。
    expect(screen.getByTestId('mobile-statusbar')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-statusbar-clock')).toBeInTheDocument()

    // Dock 安全区预留带仍是纯占位（辅助技术不可见）；Dock 本体（M1-5）
    // 在带上方，带只承担 safe-area bottom 高度（见下方 M1-5 用例）。
    expect(dock).toHaveAttribute('aria-hidden', 'true')
    expect(dock).toBeEmptyDOMElement()

    // 壁纸层全幅挂在 shell 根（padding 盒外），frame 只承担左右 padding。
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-shell-frame')).toHaveClass('mobile-shell-frame')
    expect(container.querySelector('.mobile-shell-frame')?.parentElement).toBe(shell)
  })

  it('constrains content within the safe area and reserves the scroll container (M0-4/M1-1)', () => {
    seedSessionForTests({
      id: 'u1',
      username: 'e2emobile',
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    })
    render(<MobileShell />)

    const content = screen.getByTestId('mobile-content-slot')
    const scroll = screen.getByTestId('mobile-content-scroll')

    // 滚动容器是内容区的直接滚动面（Home/应用视图挂这里）。
    expect(content).toContainElement(scroll)
    expect(scroll).toHaveClass('mobile-content-scroll')

    // Home 视图活在滚动容器内：品牌字（M0 标记位随迁）+ 品牌头 + 时段问候。
    expect(scroll).toContainElement(screen.getByTestId('mobile-home'))
    expect(screen.getByTestId('mobile-shell-brand')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-home-greeting')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'AgehaOS 移动版',
    )
  })

  it('根元素反射 mobile-nav-store 当前位置：home 默认 / openApp 后 app + appId（M1-2）', () => {
    const { rerender } = render(<MobileShell />)

    // 默认 home：只反射 view，无 appId 标记。
    const shell = screen.getByTestId('mobile-shell')
    expect(shell).toHaveAttribute('data-nav-view', 'home')
    expect(shell).not.toHaveAttribute('data-nav-app-id')

    // 导航推进（TodayWorldCard「查看世界」同一路径）：反射跟随到 app 档。
    useMobileNavStore.getState().openApp('com.ageha.dynamic.panel')
    rerender(<MobileShell />)
    expect(shell).toHaveAttribute('data-nav-view', 'app')
    expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.dynamic.panel')
  })

  // M1-5 Dock：坐在 Dock 安全区预留带上方（HANDOFF §4.0-6），DOM 序 =
  // 内容区 → Dock → 预留带；带保持纯占位空带（Home indicator 呼吸位）。
  it('Dock 挂在内容区与安全区预留带之间：固定 5 位齐、带仍纯占位（M1-5）', () => {
    localStorage.clear()
    resetAppStore()
    render(<MobileShell />)

    const dock = screen.getByTestId('mobile-dock')
    const band = screen.getByTestId('mobile-dock-slot')

    // Dock 本体在预留带上方（「填充 mobile-dock-slot 上方」契约）。
    expect(dock.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 预留带契约不变：纯占位空带、辅助技术不可见（M0-4）。
    expect(band).toHaveAttribute('aria-hidden', 'true')
    expect(band).toBeEmptyDOMElement()

    // 固定 5 位齐：Home 位 + Files/Notes/今日世界/Settings 四应用位。
    expect(screen.getByTestId('mobile-dock-home')).toBeInTheDocument()
    expect(screen.getAllByTestId('mobile-dock-app')).toHaveLength(4)
  })
})
