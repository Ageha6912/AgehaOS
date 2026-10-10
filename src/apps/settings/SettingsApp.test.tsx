import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { version } from '../../../package.json'
import { requestSettingsSection, resetAppDeepLinks } from '@/apps/app-deep-link'
import type { User } from '@/core/auth/types'
import { useLocaleStore } from '@/core/i18n'
import { resetAppStore } from '@/store/app-store'
import { resetMotionPrefsStore, useMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { SettingsApp } from './SettingsApp'

beforeEach(() => {
  resetAppStore()
  resetMotionPrefsStore()
  resetSettingsStore()
  resetSessionStore()
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('SettingsApp', () => {
  it('renders the four sections in the sidebar', () => {
    render(<SettingsApp />)

    for (const name of ['外观', '语言', '权限', '关于']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
  })

  it('registers the eclosion section and opens it (三处登记)', () => {
    render(<SettingsApp />)

    // 侧栏分区入口（本地认证下也在场，开关置灰但分区可看）。
    fireEvent.click(screen.getByRole('button', { name: '羽化' }))
    expect(screen.getByRole('region', { name: '羽化' })).toBeInTheDocument()
    // 本地认证：总开关置灰 + 原因提示（§9.3 准入）。
    expect(screen.getByTestId('eclosion-enable-toggle')).toBeDisabled()
    expect(screen.getByText(/本地认证下始终使用原生应用/)).toBeInTheDocument()
    // 三件套生成方式子开关同样置灰（总开关未开）。
    expect(screen.getByTestId('eclosion-mode-calculator-toggle')).toBeDisabled()
  })

  it('switches the theme via the appearance options', () => {
    render(<SettingsApp />)

    const lightButton = screen.getByRole('button', { name: '浅色' })
    fireEvent.click(lightButton)
    expect(lightButton).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    const darkButton = screen.getByRole('button', { name: '深色' })
    fireEvent.click(darkButton)
    expect(darkButton).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('exposes the five motion-lab toggles defaulting on (§32.5 修订 10)', () => {
    render(<SettingsApp />)

    const testIds = [
      'motion-glow-toggle',
      'motion-aurora-toggle',
      'motion-window-tilt-toggle',
      'motion-dock-sheen-toggle',
      'motion-theme-glow-toggle',
    ]
    for (const testId of testIds) {
      expect(screen.getByTestId(testId).getAttribute('aria-checked')).toBe('true')
    }

    // 关掉流光氛围 → 偏好落库（设备本地）。
    fireEvent.click(screen.getByTestId('motion-aurora-toggle'))
    expect(screen.getByTestId('motion-aurora-toggle').getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(localStorage.getItem('agehaos.motion.prefs.v1') ?? '{}')).toMatchObject({
      aurora: false,
    })
  })

  it('exposes the spatial motion toggle defaulting on with its hint (2026-10-10 空间化裁决 3)', () => {
    render(<SettingsApp />)

    // 正相呈现（桌面档）：spatialMotion 默认开，带一句说明（窗口深度与悬浮氛围动效）。
    const toggle = screen.getByTestId('motion-spatial-toggle')
    expect(useMotionPrefsStore.getState().spatialMotion).toBe(true)
    expect(toggle).toHaveAttribute('role', 'switch')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveAttribute('aria-label', '空间动效')
    expect(screen.getByText('窗口深度与悬浮氛围动效')).toBeInTheDocument()

    // 关掉空间动效 → 偏好落库（设备本地），开关 aria-checked 跟随。
    fireEvent.click(toggle)
    expect(screen.getByTestId('motion-spatial-toggle').getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(localStorage.getItem('agehaos.motion.prefs.v1') ?? '{}')).toMatchObject({
      spatialMotion: false,
    })
  })

  it('changes the font size', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: '大' }))

    expect(useSettingsStore.getState().fontSize).toBe('large')
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('switches the interface language', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: /语言/ }))
    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByRole('region', { name: 'Language' })).toBeInTheDocument()
    expect(useLocaleStore.getState().locale).toBe('en')
  })

  it('lists installed apps with their granted permissions', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: /权限/ }))

    // 展示名本地化（原生与羽化记事本同名共存，各占一行）。
    expect(screen.getAllByText('记事').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('文件').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('使用本地存储').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('读取文件、写入文件、使用本地存储')).toBeInTheDocument()
    // 羽化三件套也在此列（grantAll 静默授权，规格即权限面）。
    expect(screen.getByText('时钟')).toBeInTheDocument()
    expect(screen.getByText('读取文件、写入文件')).toBeInTheDocument()
  })

  it('shows the about section with the version', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: /关于/ }))

    expect(screen.getByText(new RegExp(version))).toBeInTheDocument()
  })

  it('shows the admin-only sections only for admin-role users (ADR 20/22)', () => {
    // 普通用户：无 远程目录 / 内容复审 入口。
    seedSessionForTests({
      id: 'u-2',
      username: 'plain',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    } satisfies User)
    const { unmount } = render(<SettingsApp />)
    expect(screen.queryByRole('button', { name: '远程目录' })).toBeNull()
    expect(screen.queryByRole('button', { name: '内容复审' })).toBeNull()
    unmount()

    // admin 用户：两个管理分区出现，且复审分区可打开。
    seedSessionForTests({
      id: 'u-3',
      username: 'boss',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
      role: 'admin',
    } satisfies User)
    render(<SettingsApp />)
    fireEvent.click(screen.getByRole('button', { name: '内容复审' }))
    expect(screen.getByTestId('sample-review-section')).toBeInTheDocument()
  })
})

/**
 * 窄容器分支（M2-6）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；几何级断言（横向
 * 溢出 / 命中区实测）归 e2e/mobile-notes-settings.spec.ts 真实视口。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** 手动喂一次观测回调（内容盒宽度）。真实 RO 在 observe 时必发初始帧。 */
  emit(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

describe('SettingsApp 窄容器（M2-6）', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    resetAppDeepLinks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderNarrow() {
    render(<SettingsApp />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })
  }

  it('窄容器：分区列表单列首面（去双栏、默认不挂载分区内容、行 44px）', async () => {
    await renderNarrow()

    // 双栏整块不渲染：侧栏 aside 与分区内容都不在场，纵向单列分区列表接管。
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '外观' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('motion-glow-toggle')).not.toBeInTheDocument()
    const nav = screen.getByTestId('settings-section-nav')
    expect(nav).toHaveAttribute('aria-label', '设置分区')

    // 分区入口 ≥44px（§35.3）：分区列表是纵向单列（非 Files 的横向 chip 行）。
    const row = within(nav).getByRole('button', { name: '外观' })
    expect(row.className).toContain('min-h-[44px]')
    // admin 门控跟随：普通用户列表无 远程目录 / 内容复审。
    expect(within(nav).queryByRole('button', { name: '远程目录' })).toBeNull()
    expect(within(nav).queryByRole('button', { name: '内容复审' })).toBeNull()
  })

  it('窄容器：点入分区→单列详情面，切换设置项生效，返回后 aria-current 跟随', async () => {
    await renderNarrow()

    // 点入外观：详情面 = 返回键 + 分区标题 + 单列分区内容（一次只挂载当前分区）。
    fireEvent.click(within(screen.getByTestId('settings-section-nav')).getByRole('button', { name: '外观' }))
    expect(screen.getByTestId('settings-section-pane')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '外观' })).toBeInTheDocument()

    // 触控 ≥44px（§35.3）：主题选项按钮抬档；切换设置项（深色）真实生效。
    const dark = screen.getByRole('button', { name: '深色' })
    expect(dark.className).toContain('min-h-[44px]')
    fireEvent.click(dark)
    expect(dark).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // 返回：分区列表回归，当前分区高亮（aria-current）。
    fireEvent.click(screen.getByTestId('settings-back-to-sections'))
    expect(screen.getByTestId('settings-section-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-pane')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('settings-section-nav')).getByRole('button', { name: '外观' }),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('窄容器深链：requestSettingsSection 命中时首面直接落在该分区详情面', async () => {
    requestSettingsSection('account')
    await renderNarrow()

    // §32「本次启动直接落在账户分区」在窄容器同样成立：跳过列表面。
    expect(screen.getByTestId('settings-section-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-nav')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-section-pane')).toHaveTextContent('账户')
    // 深链只定面不改门控：未登录（本地认证无会话）时账户分区内容仍不挂载。
    expect(screen.queryByRole('region', { name: '账户' })).not.toBeInTheDocument()
  })

  it('宽容器（840px 桌面窗口档）：双栏原样、单列结构缺席、桌面密度档保持', async () => {
    render(<SettingsApp />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(840)
    })

    // 宽容器双栏原样：侧栏在场 + 默认挂载外观分区；窄容器专属结构不渲染。
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '外观' })).toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-nav')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-back-to-sections')).not.toBeInTheDocument()
    // 桌面密度档保持：主题选项按钮不带 44px 抬档。
    expect(screen.getByRole('button', { name: '浅色' }).className).toContain('h-8')
    expect(screen.getByRole('button', { name: '浅色' }).className).not.toContain('min-h-[44px]')
  })
})
