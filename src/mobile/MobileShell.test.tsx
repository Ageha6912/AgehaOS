import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MobileShell } from './MobileShell'

/**
 * M0-4 Safe Area：移动 Shell 三段骨架的 DOM 契约。safe-area 的几何语义
 * （env(safe-area-inset-*) 与 max() 保底高度）jsdom 算不了 env，几何探针
 * 归 E2E（e2e/mobile-shell.spec.ts）；这里钉住结构与类名接线，防止后续
 * 切片静默拆掉占位带/滚动容器。
 */
describe('MobileShell', () => {
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

    // 占位带为纯占位（辅助技术不可见），内容归 M1。
    expect(statusbar).toHaveAttribute('aria-hidden', 'true')
    expect(dock).toHaveAttribute('aria-hidden', 'true')
    expect(statusbar).toBeEmptyDOMElement()
    expect(dock).toBeEmptyDOMElement()

    // 壁纸层全幅挂在 shell 根（padding 盒外），frame 只承担左右 padding。
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-shell-frame')).toHaveClass('mobile-shell-frame')
    expect(container.querySelector('.mobile-shell-frame')?.parentElement).toBe(shell)
  })

  it('constrains content within the safe area and reserves the scroll container (M0-4)', () => {
    render(<MobileShell />)

    const content = screen.getByTestId('mobile-content-slot')
    const scroll = screen.getByTestId('mobile-content-scroll')

    // 滚动容器是内容区的直接滚动面（M1 的 Home/应用视图挂这里）。
    expect(content).toContainElement(scroll)
    expect(scroll).toHaveClass('mobile-content-scroll')

    // 品牌占位字活在滚动容器内（内容随安全区约束，不越界到占位带上）。
    expect(scroll).toContainElement(screen.getByTestId('mobile-shell-brand'))
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'AgehaOS 移动版',
    )
  })
})
