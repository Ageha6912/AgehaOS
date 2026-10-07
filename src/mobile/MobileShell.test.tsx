import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MobileShell } from './MobileShell'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

/**
 * M0-4 Safe Area + M1-1：移动 Shell 三段骨架的 DOM 契约。safe-area 的几何
 * 语义（env(safe-area-inset-*) 与 max() 保底高度）jsdom 算不了 env，几何探针
 * 归 E2E（e2e/mobile-shell.spec.ts）；这里钉住结构与类名接线，防止后续
 * 切片静默拆掉占位带/滚动容器。M1-1 起状态栏填充真实状态条（不再
 * aria-hidden 空占位）、内容区挂 Home 视图。
 */
describe('MobileShell', () => {
  afterEach(() => {
    resetSessionStore()
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

    // Dock 带仍是纯占位（辅助技术不可见），填充归 M1 Dock 切片。
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
    expect(scroll).toContainElement(screen.getByTestId('mobile-shell-brand'))
    expect(screen.getByTestId('mobile-home-greeting')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'AgehaOS 移动版',
    )
  })
})
