import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthProvider } from '@/core/auth'
import { setAuthProvider } from '@/core/auth'
import { systemEclosion } from '@/services/eclosion'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'

import { EclosionSection } from './EclosionSection'

/**
 * Settings「羽化」区（AI-GENERATED-APPS-DESIGN §9.3/§12 P1）：开关置灰逻辑
 * （本地认证 / 服务端未配置 AI）、生成方式子开关、额度显示、清除数据。
 * 编排器单例的副作用（refreshQuota/schedulePrefetch/clearData）以 spy 隔离。
 */

function enableRemoteAuth(): void {
  setAuthProvider({} as unknown as AuthProvider)
}

beforeEach(() => {
  localStorage.clear()
  resetEclosionStore()
  seedEclosionForTests('u-settings', false)
  vi.spyOn(systemEclosion, 'refreshQuota').mockResolvedValue(undefined)
  vi.spyOn(systemEclosion, 'schedulePrefetch').mockImplementation(() => undefined)
  vi.spyOn(systemEclosion, 'refreshWorld').mockResolvedValue(false)
  vi.spyOn(systemEclosion, 'clearData').mockResolvedValue(undefined)
  vi.spyOn(systemEclosion, 'listReplay').mockResolvedValue([])
})

afterEach(() => {
  setAuthProvider(null)
  vi.restoreAllMocks()
})

describe('EclosionSection（总开关置灰逻辑，§9.3 准入）', () => {
  it('greys the toggle out under local auth with the reason visible', () => {
    render(<EclosionSection />)

    const toggle = screen.getByTestId('eclosion-enable-toggle')
    expect(toggle).toBeDisabled()
    expect(screen.getByText('羽化模式仅在远程认证模式下可用；本地认证下始终使用原生应用。')).toBeInTheDocument()

    // 置灰开关点不动。
    fireEvent.click(toggle)
    expect(useEclosionStore.getState().enabled).toBe(false)
  })

  it('greys the toggle out when the server reports no AI configured (remote mode)', () => {
    enableRemoteAuth()
    useEclosionStore.getState().applyQuota({
      configured: false,
      basic: { used: 0, limit: 10 },
      today: { used: 0, limit: 30 },
      imagine: { used: 0, limit: 20 },
      resetAtIso: null,
    })
    render(<EclosionSection />)

    expect(screen.getByTestId('eclosion-enable-toggle')).toBeDisabled()
    expect(screen.getByTestId('eclosion-ai-not-configured')).toHaveTextContent('服务端未配置 AI')
    // 额度行同步显示不可用。
    expect(screen.getByTestId('eclosion-quota')).toHaveTextContent('暂无法获取额度')
  })

  it('still allows turning an already-enabled toggle off when AI is no longer configured (D2 审查)', () => {
    enableRemoteAuth()
    seedEclosionForTests('u-settings', true)
    useEclosionStore.getState().applyQuota({
      configured: false,
      basic: { used: 0, limit: 10 },
      today: { used: 0, limit: 30 },
      imagine: { used: 0, limit: 20 },
      resetAtIso: null,
    })
    render(<EclosionSection />)

    const toggle = screen.getByTestId('eclosion-enable-toggle')
    // 开启方向仍提示不可用，但已是 enabled 的用户必须能关掉（旧实现锁死在开）。
    expect(toggle).toBeEnabled()
    fireEvent.click(toggle)
    expect(useEclosionStore.getState().enabled).toBe(false)
  })

  it('enables the toggle under remote auth with a configured backend', () => {
    enableRemoteAuth()
    useEclosionStore.getState().applyQuota({
      configured: true,
      basic: { used: 3, limit: 10 },
      today: { used: 1, limit: 30 },
      imagine: { used: 0, limit: 20 },
      resetAtIso: '2026-10-03T00:00:00.000Z',
    })
    render(<EclosionSection />)

    const toggle = screen.getByTestId('eclosion-enable-toggle')
    expect(toggle).toBeEnabled()
    // 额度展示：used/limit + 重置时间。
    expect(screen.getByTestId('eclosion-quota')).toHaveTextContent('3 / 10')

    fireEvent.click(toggle)
    expect(useEclosionStore.getState().enabled).toBe(true)
    // 开启即安排空闲预取（§5.2）+ 拉取今日世界（§6.2）。
    expect(systemEclosion.schedulePrefetch).toHaveBeenCalled()
    expect(systemEclosion.refreshWorld).toHaveBeenCalled()
  })
})

describe('EclosionSection（主题跟随今日世界，§6.3）', () => {
  it('defaults the toggle to on, greyed out until the master toggle is on', () => {
    enableRemoteAuth()
    render(<EclosionSection />)

    const follow = screen.getByTestId('eclosion-theme-follow-toggle')
    expect(follow).toHaveAttribute('aria-checked', 'true') // 默认开
    expect(follow).toBeDisabled()

    act(() => {
      useEclosionStore.getState().setEnabled(true)
    })
    expect(screen.getByTestId('eclosion-theme-follow-toggle')).toBeEnabled()
  })

  it('toggles the preference, persists it, and re-pulls the world when re-enabled', () => {
    enableRemoteAuth()
    act(() => {
      seedEclosionForTests('u-theme', true)
    })
    render(<EclosionSection />)

    fireEvent.click(screen.getByTestId('eclosion-theme-follow-toggle'))
    expect(useEclosionStore.getState().themeFollow).toBe(false)
    expect(systemEclosion.refreshWorld).not.toHaveBeenCalled() // 关闭：不接主题

    fireEvent.click(screen.getByTestId('eclosion-theme-follow-toggle'))
    expect(useEclosionStore.getState().themeFollow).toBe(true)
    // 重新打开：重拉/重播当日世界 → world.ready → 主题立即接回。
    expect(systemEclosion.refreshWorld).toHaveBeenCalledTimes(1)
    // 偏好落盘。
    expect(
      JSON.parse(String(localStorage.getItem('agehaos.eclosion.prefs.v1.u-theme'))),
    ).toMatchObject({ themeFollow: true })
  })
})

describe('EclosionSection（生成方式 / 清除数据）', () => {
  it('lists the trio with per-app toggles that stay disabled until the master toggle is on', () => {
    enableRemoteAuth()
    render(<EclosionSection />)

    const calc = screen.getByTestId('eclosion-mode-calculator-toggle')
    expect(calc).toHaveAttribute('aria-checked', 'true') // 默认羽化
    expect(calc).toBeDisabled() // 总开关关 → 子开关置灰

    act(() => {
      useEclosionStore.getState().setEnabled(true)
    })
    expect(screen.getByTestId('eclosion-mode-calculator-toggle')).toBeEnabled()

    fireEvent.click(screen.getByTestId('eclosion-mode-calculator-toggle'))
    expect(useEclosionStore.getState().modes.calculator).toBe('classic')
    expect(screen.getByTestId('eclosion-mode-calculator-toggle')).toHaveAttribute('aria-checked', 'false')
  })

  it('clears the eclosion cache after confirmation and confirms', async () => {
    enableRemoteAuth()
    render(<EclosionSection />)

    fireEvent.click(screen.getByTestId('eclosion-clear'))
    // 不可逆操作：先落在二次确认弹层上，取消不执行。
    const dialog = screen.getByRole('dialog', { name: '清除羽化数据' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(systemEclosion.clearData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('eclosion-clear'))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '清除羽化数据' })).getByRole('button', {
        name: '清除羽化数据',
      }),
    )
    await waitFor(() => expect(systemEclosion.clearData).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('eclosion-cleared-notice')).toBeInTheDocument())
  })

  it('shows an inline error and keeps the dialog when clearing fails', async () => {
    enableRemoteAuth()
    vi.mocked(systemEclosion.clearData).mockRejectedValueOnce(new Error('boom'))
    render(<EclosionSection />)

    fireEvent.click(screen.getByTestId('eclosion-clear'))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '清除羽化数据' })).getByRole('button', {
        name: '清除羽化数据',
      }),
    )

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('清除失败，请稍后重试。'),
    )
    expect(screen.getByRole('dialog', { name: '清除羽化数据' })).toBeInTheDocument()
    expect(screen.queryByTestId('eclosion-cleared-notice')).toBeNull()
  })

  it('fetches a quota snapshot when the section opens', () => {
    enableRemoteAuth()
    render(<EclosionSection />)
    expect(systemEclosion.refreshQuota).toHaveBeenCalled()
  })
})

// ── 蝶谱时间线（§8/P4：replay 记录展示 +「回到那天的主题」只动主题） ────────

import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { worldWallpaperSeed } from '@/services/world-theme'
import type { EclosionReplayEntry } from '@/services/eclosion-cache'

describe('EclosionSection × 蝶谱时间线（P4 §8）', () => {
  const ENTRY: EclosionReplayEntry = {
    worldDate: '2026-10-01',
    headline: '旧日世界的标题',
    paletteId: 'nebula-violet',
    accentHue: 212,
    apps: [
      { slug: 'app-01', name: '甲应用', hue: 200, tagline: '一句话', category: 'tools' },
      { slug: 'app-02', name: '乙应用', hue: 220, tagline: '另一句', category: 'tools' },
    ],
    createdAt: '2026-10-01T02:00:00.000Z',
  }

  beforeEach(() => {
    resetDynamicDesktopStore()
  })

  afterEach(() => {
    resetDynamicDesktopStore()
  })

  it('hides the timeline while the master toggle is off', async () => {
    render(<EclosionSection />)
    await waitFor(() => expect(systemEclosion.refreshQuota).toHaveBeenCalled())
    expect(screen.queryByTestId('eclosion-replay-section')).toBeNull()
    expect(systemEclosion.listReplay).not.toHaveBeenCalled()
  })

  it('lists replay entries with date, headline, palette stripe and app names', async () => {
    seedEclosionForTests('u-replay', true)
    vi.mocked(systemEclosion.listReplay).mockResolvedValue([ENTRY])
    render(<EclosionSection />)

    await waitFor(() => expect(screen.getByTestId('eclosion-replay-entry')).toBeInTheDocument())
    const row = screen.getByTestId('eclosion-replay-entry')
    expect(row.textContent).toContain('2026-10-01')
    expect(row.textContent).toContain('旧日世界的标题')
    expect(row.textContent).toContain('甲应用 · 乙应用')
    // 配色条：accentHue 决定色相（hsl）。
    expect(row.querySelector('span[aria-hidden="true"]')).toHaveStyle({
      background: 'hsl(212 80% 55%)',
    })
  })

  it('shows the empty hint when no replay entries exist yet', async () => {
    seedEclosionForTests('u-replay', true)
    vi.mocked(systemEclosion.listReplay).mockResolvedValue([])
    render(<EclosionSection />)

    await waitFor(() => expect(screen.getByTestId('eclosion-replay-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('eclosion-replay-list')).toBeNull()
  })

  it('reverts only the theme and wallpaper on “回到那天的主题” (不恢复应用/不新增蝶谱)', async () => {
    seedEclosionForTests('u-replay', true)
    vi.mocked(systemEclosion.listReplay).mockResolvedValue([ENTRY])
    useDynamicDesktopStore.setState({
      prefs: { ...useDynamicDesktopStore.getState().prefs, enabled: true },
    })
    useEclosionStore.setState({
      world: {
        worldDate: '2026-10-03',
        headline: '今日世界',
        paletteId: 'coral-reef',
        accentHue: 20,
        degraded: false,
        signalCount: 1,
        signals: { titles: ['今日信号'], sourceName: 'x', sourceUrl: '' },
        apps: [
          {
            slug: 'app-01',
            name: '今日应用',
            hue: 210,
            tagline: 't',
            category: 'tools',
            window: { width: 720, height: 480 },
          },
        ],
      },
      keptAppIds: ['com.ageha.eclosion.app-01'],
    })
    render(<EclosionSection />)
    await waitFor(() => expect(screen.getByTestId('eclosion-replay-revert')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('eclosion-replay-revert'))

    // 壁纸换成那日种子（hash(那日 worldDate+headline)），主题 accent 同步换相。
    const plan = useDynamicDesktopStore.getState().currentPlan
    expect(plan?.seed).toBe(worldWallpaperSeed('2026-10-01', '旧日世界的标题'))
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).not.toBe('')
    // 应用面不受影响：今日世界摘要与留存清单原样；蝶谱不新增（listReplay 仍只读一次）。
    expect(useEclosionStore.getState().world?.worldDate).toBe('2026-10-03')
    expect(useEclosionStore.getState().keptAppIds).toEqual(['com.ageha.eclosion.app-01'])
    expect(systemEclosion.listReplay).toHaveBeenCalledTimes(1)
    // 清理 inline accent（防泄漏到后续用例）。
    document.documentElement.style.removeProperty('--ag-primary')
  })
})
