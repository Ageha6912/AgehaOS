import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { installApp, resetAppStore, uninstallApp, useAppStore } from '@/store/app-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'

import { MOBILE_APP_ORDER } from '../shared/mobile-app-order'
import { MobileAppGrid } from './MobileAppGrid'

/**
 * M1-4 应用网格契约：`useAppStore(s => s.apps)` 全量已安装应用 4 列网格——
 * - 渲染数量 = 注册表条数（boot = 7 内置 + 羽化 L1 三件套 = 10，全量不分页）；
 * - 排序 = MOBILE_APP_ORDER 常量优先序在前、未列入按本地化展示名排后
 *   （./shared/mobile-app-order 纯函数，单测另钉）；
 * - 整格点击 = mobile-nav-store.openApp 导航推进（M1-6 前不真实开窗）；
 * - 注册表 commit（安装/卸载）即刻重渲染；
 * - 空态（防御位）整块含标题不渲染（禁止空壳）。
 */

/** 渲染结果里的瓦片 appId 序（= 排序纯函数的输出序）。 */
function renderedAppIds(): string[] {
  return screen
    .getAllByTestId('mobile-app-tile')
    .map((tile) => tile.getAttribute('data-app-id') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  // 内建清单入场（与 app-store.test.ts 同口径：7 内置 + 羽化 L1 三件套）。
  resetAppStore()
  resetMobileNavStore()
})

afterEach(() => {
  // en 档测试不向同文件后续用例泄漏 locale（与 RecentApps.test.tsx 同口径）。
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('MobileAppGrid', () => {
  it('渲染数量 = 注册表条数：boot 全量 10 格（7 内置 + 羽化 L1），不分页', () => {
    render(<MobileAppGrid />)

    const registrySize = useAppStore.getState().apps.length
    expect(registrySize).toBe(10)
    expect(screen.getAllByTestId('mobile-app-tile')).toHaveLength(registrySize)
    expect(screen.getAllByTestId('mobile-app-tile')).toHaveLength(10)
  })

  it('排序：前 7 格 = 常量优先序，羽化 L1 按本地化展示名排后（zh：时钟→计算器→记事）', () => {
    render(<MobileAppGrid />)

    const ids = renderedAppIds()
    expect(ids.slice(0, MOBILE_APP_ORDER.length)).toEqual([...MOBILE_APP_ORDER])
    // 未列入组（羽化 L1）：appDisplayName zh 值的码元序 时(U+65F6) <
    // 计(U+8BA1) < 记(U+8BB0)。
    expect(ids.slice(MOBILE_APP_ORDER.length)).toEqual([
      'com.ageha.eclosion.clock',
      'com.ageha.eclosion.calculator',
      'com.ageha.eclosion.notes',
    ])
  })

  it('名称 = appDisplayName 本地化展示名（内置走 titleKey，非 manifest.name 原文）', () => {
    render(<MobileAppGrid />)

    const grid = screen.getByTestId('mobile-app-grid')
    // 判别位：羽化计算器的 manifest.name = specId（'calculator'），展示名必须是
    // zh titleKey「计算器」；内置计算器同键同文，故恰好两格「计算器」。
    expect(within(grid).getAllByText('计算器')).toHaveLength(2)
    expect(within(grid).queryByText('calculator')).toBeNull()
  })

  it('4 列网格 + 触控纪律：grid-cols-4 钉位、整格命中区下限 44px（§35.3）', () => {
    render(<MobileAppGrid />)

    expect(screen.getByTestId('mobile-app-grid-list')).toHaveClass('grid-cols-4')
    for (const tile of screen.getAllByTestId('mobile-app-tile')) {
      expect(tile).toHaveClass('min-h-[44px]')
      expect(tile).toHaveClass('min-w-[44px]')
    }
  })

  it('徽章 56px（切片口径 52–64px 带），AppIcon 复用不做第二套图标', () => {
    render(<MobileAppGrid />)

    const tile = screen.getAllByTestId('mobile-app-tile')[0]!
    // AppIcon 渲染为按钮内首个 span（装饰位 aria-hidden，可访问名由标签文本
    // 承担），内联 style 定徽章边长。
    const badge = tile.firstElementChild as HTMLElement
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveStyle({ width: '56px', height: '56px' })
  })

  it('整格点击 = openApp 导航推进（过渡语义，M1-6 AppHost 前不真实开窗）', () => {
    render(<MobileAppGrid />)

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    const firstTile = screen.getAllByTestId('mobile-app-tile')[0]!
    expect(firstTile).toHaveAttribute('data-app-id', 'com.ageha.dynamic.panel')
    fireEvent.click(firstTile)

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.dynamic.panel',
    })
  })

  it('注册表 commit 即刻重渲染：安装第三方 +1 格（未列入按名排后）、卸载 -1 格', () => {
    render(<MobileAppGrid />)
    expect(renderedAppIds()).toHaveLength(10)

    act(() => {
      expect(
        installApp({
          id: 'com.ageha.thirdparty',
          name: 'Zebra Tool',
          version: '1.0.0',
          entry: '/apps/thirdparty/index.html',
          permissions: [],
        }).ok,
      ).toBe(true)
    })
    expect(renderedAppIds()).toHaveLength(11)
    // 未列入组按展示名小写码元序排后：'zebra tool'（ASCII 'z' = 0x7A）落在
    // 全部 CJK 名（时钟 U+65F6 起）之前、优先序 7 格之后 → 表位 8（下标 7）。
    expect(renderedAppIds()[7]).toBe('com.ageha.thirdparty')

    act(() => {
      expect(uninstallApp('com.ageha.thirdparty')).toBe(true)
    })
    expect(renderedAppIds()).toHaveLength(10)
  })

  it('标题走 i18n：zh-CN「全部应用」/ en「All Apps」，同时进 aria-label', () => {
    const { rerender } = render(<MobileAppGrid />)

    const section = screen.getByTestId('mobile-app-grid')
    expect(section).toHaveAttribute('aria-label', '全部应用')
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('全部应用')

    setLocale('en')
    rerender(<MobileAppGrid />)
    expect(screen.getByTestId('mobile-app-grid')).toHaveAttribute('aria-label', 'All Apps')
    expect(
      within(screen.getByTestId('mobile-app-grid')).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('All Apps')
    // locale 切换后名称同步重取（不 memo 的原因）：羽化计算器 zh「计算器」→
    // en「Calculator」（内置计算器同键同文，恰好两格）。
    expect(within(screen.getByTestId('mobile-app-grid')).getAllByText('Calculator')).toHaveLength(2)
  })

  it('空态（防御位）：注册表为空 → 整块（含标题）不渲染', () => {
    act(() => {
      useAppStore.setState({ apps: [] })
    })
    render(<MobileAppGrid />)

    expect(screen.queryByTestId('mobile-app-grid')).toBeNull()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.queryByTestId('mobile-app-tile')).toBeNull()
  })
})
