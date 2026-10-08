import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { resetAppStore, uninstallApp } from '@/store/app-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'

import { RecentApps } from './RecentApps'

/**
 * M1-3 最近使用区契约：usage-store 前 4 条 × getAppManifest 解析——
 * - 前 4 截取（usage-store 时序，最新在前），第 5 条起不渲染；
 * - 空态（recent 为空 / 全部解析失败）整块含标题不渲染（禁止空壳）；
 * - 坏条目（解析不到）跳过且不回填第 5 条（「先截取、后解析」口径）；
 * - 整格点击 = mobile-nav-store.openApp 导航推进（M1-6 前不真实开窗）。
 */

function seedRecent(appIds: string[]): void {
  useUsageStore.setState({
    recent: appIds.map((appId, index) => ({ appId, at: 1_000 + index })),
  })
}

/** 渲染结果里的瓦片 appId 序（usage-store 时序应原样保留）。 */
function renderedAppIds(): string[] {
  return screen
    .queryAllByTestId('mobile-recent-app')
    .map((tile) => tile.getAttribute('data-app-id') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  // 内建清单入场（与 usage-store.test.ts 同口径）+ 清空最近 + 导航归位。
  resetAppStore()
  resetUsageStore()
  resetMobileNavStore()
})

afterEach(() => {
  // en 档测试不向同文件后续用例泄漏 locale（与 i18n.test.ts 同口径）。
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('RecentApps', () => {
  it('前 4 截取：5 条 recent 只渲染最新 4 格，时序保持、第 5 条缺席', () => {
    seedRecent([
      'com.ageha.notes',
      'com.ageha.files',
      'com.ageha.calculator',
      'com.ageha.terminal',
      'com.ageha.store',
    ])
    render(<RecentApps />)

    expect(renderedAppIds()).toEqual([
      'com.ageha.notes',
      'com.ageha.files',
      'com.ageha.calculator',
      'com.ageha.terminal',
    ])
  })

  it('空态隐藏：recent 为空 → 整块（含标题）不渲染', () => {
    render(<RecentApps />)

    expect(screen.queryByTestId('mobile-recent-apps')).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.queryByTestId('mobile-recent-app')).toBeNull()
  })

  it('坏条目跳过：解析不到的条目不渲染，且不回填第 5 条（先截取后解析）', () => {
    seedRecent([
      'com.ageha.notes',
      'com.ageha.uninstalled.app',
      'com.ageha.files',
      'com.ageha.calculator',
      'com.ageha.terminal',
    ])
    render(<RecentApps />)

    expect(renderedAppIds()).toEqual([
      'com.ageha.notes',
      'com.ageha.files',
      'com.ageha.calculator',
    ])
    expect(screen.queryByTestId('mobile-recent-apps')).not.toBeNull()
  })

  it('全部解析失败 → 整块缺席（与空 recent 同一口径）', () => {
    seedRecent(['com.ageha.gone-a', 'com.ageha.gone-b'])
    render(<RecentApps />)

    expect(screen.queryByTestId('mobile-recent-apps')).toBeNull()
  })

  it('标题走 i18n：zh-CN「最近使用」/ en「Recently Used」，同时进 aria-label', () => {
    seedRecent(['com.ageha.notes'])
    const { rerender } = render(<RecentApps />)

    const section = screen.getByTestId('mobile-recent-apps')
    expect(section).toHaveAttribute('aria-label', '最近使用')
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('最近使用')

    setLocale('en')
    rerender(<RecentApps />)
    expect(screen.getByTestId('mobile-recent-apps')).toHaveAttribute('aria-label', 'Recently Used')
    expect(
      within(screen.getByTestId('mobile-recent-apps')).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('Recently Used')
  })

  it('整格点击 = openApp 导航推进（windowId 待 M1-6 AppHost 真实启动落地）', () => {
    seedRecent(['com.ageha.notes', 'com.ageha.files'])
    render(<RecentApps />)

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    const firstTile = screen.getAllByTestId('mobile-recent-app')[0]!
    expect(firstTile).toHaveAttribute('data-app-id', 'com.ageha.notes')
    fireEvent.click(firstTile)

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: null,
    })
  })

  it('应用名来自 manifest（内建注册表），徽章 AppIcon 复用不做第二套图标', () => {
    seedRecent(['com.ageha.notes', 'com.ageha.store'])
    render(<RecentApps />)

    const section = screen.getByTestId('mobile-recent-apps')
    expect(within(section).getByText('Notes')).toBeInTheDocument()
    expect(within(section).getByText('App Store')).toBeInTheDocument()
    // §35.3 触控纪律的类名钉位：命中区下限 44px（真实几何归 E2E 探针）。
    for (const tile of screen.getAllByTestId('mobile-recent-app')) {
      expect(tile).toHaveClass('min-h-[44px]')
    }
  })

  it('卸载已记录的应用：注册表 commit 后瓦片即刻消失（apps 订阅重跑解析）', () => {
    seedRecent(['com.ageha.notes', 'com.ageha.files'])
    render(<RecentApps />)
    expect(renderedAppIds()).toEqual(['com.ageha.notes', 'com.ageha.files'])

    act(() => {
      expect(uninstallApp('com.ageha.notes')).toBe(true)
    })

    expect(renderedAppIds()).toEqual(['com.ageha.files'])
  })
})
