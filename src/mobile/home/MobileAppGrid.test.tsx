import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { installApp, resetAppStore, uninstallApp, useAppStore } from '@/store/app-store'
import { resetMobileLauncherStore, useMobileLauncherStore } from '@/store/mobile-launcher-store'
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
 * M2-1 增补：标题行右侧搜索按钮 = 启动器抽屉入口（开/关/回焦），抽屉内
 * 全量应用 + 点击行 openApp 分发（抽屉自身契约在 launcher/MobileLauncher.test）。
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
  // 抽屉开合归 store（M3-1 起与上滑手势共享）：用例间回关闭态。
  resetMobileLauncherStore()
})

afterEach(() => {
  // en 档测试不向同文件后续用例泄漏 locale（与 RecentApps.test.tsx 同口径）。
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('MobileAppGrid', () => {
  it('渲染数量 = 注册表条数：boot 全量 11 格（8 内置含浏览器 + 羽化 L1），不分页', () => {
    render(<MobileAppGrid />)

    const registrySize = useAppStore.getState().apps.length
    expect(registrySize).toBe(11)
    expect(screen.getAllByTestId('mobile-app-tile')).toHaveLength(registrySize)
    expect(screen.getAllByTestId('mobile-app-tile')).toHaveLength(11)
  })

  it('排序：前 8 格 = 常量优先序，羽化 L1 按本地化展示名排后（zh：时钟→计算器→记事）', () => {
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

  it('整格点击 = openApp 导航推进（windowId 待 M1-6 AppHost 真实启动落地）', () => {
    render(<MobileAppGrid />)

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    const firstTile = screen.getAllByTestId('mobile-app-tile')[0]!
    expect(firstTile).toHaveAttribute('data-app-id', 'com.ageha.dynamic.panel')
    fireEvent.click(firstTile)

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.dynamic.panel',
      windowId: null,
    })
  })

  it('注册表 commit 即刻重渲染：安装第三方 +1 格（未列入按名排后）、卸载 -1 格', () => {
    render(<MobileAppGrid />)
    expect(renderedAppIds()).toHaveLength(11)

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
    expect(renderedAppIds()).toHaveLength(12)
    // 未列入组按展示名小写码元序排后：'zebra tool'（ASCII 'z' = 0x7A）落在
    // 全部 CJK 名（时钟 U+65F6 起）之前、优先序 8 格之后 → 表位 9（下标 8）。
    expect(renderedAppIds()[8]).toBe('com.ageha.thirdparty')

    act(() => {
      expect(uninstallApp('com.ageha.thirdparty')).toBe(true)
    })
    expect(renderedAppIds()).toHaveLength(11)
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
    // 启动器入口（M2-1）随网格同退：无网格 = 无入口按钮。
    expect(screen.queryByTestId('mobile-launcher-open')).toBeNull()
  })

  it('M2-1 启动器入口：标题行搜索按钮打开抽屉，backdrop 点击 / Esc 关闭并回焦触发器', async () => {
    render(<MobileAppGrid />)

    // 入口在场：i18n 可访问名 + 44×44 命中区类（§35.3）；初始无抽屉。
    const trigger = screen.getByTestId('mobile-launcher-open')
    expect(trigger).toHaveAttribute('aria-label', '搜索应用')
    expect(trigger).toHaveClass('h-11', 'w-11')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mobile-launcher')).toBeNull()

    // 打开：Bottom Sheet 在场（open 态），aria-expanded 反射 store 开合。
    fireEvent.click(trigger)
    expect(screen.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('mobile-launcher-sheet')).toHaveAttribute('role', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // backdrop 点击关闭：退场帧（≤200ms）播完卸载，焦点回触发器（§0.4）。
    fireEvent.click(screen.getByTestId('mobile-launcher-backdrop'))
    await waitFor(
      () => expect(screen.queryByTestId('mobile-launcher')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
    expect(trigger).toHaveFocus()

    // Esc 关闭同路（document 捕获阶段）。
    fireEvent.click(trigger)
    expect(screen.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'open')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(
      () => expect(screen.queryByTestId('mobile-launcher')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
    expect(trigger).toHaveFocus()
  })

  it('M2-1 抽屉内容 = 启动器同源：全量应用 + 点击行推进 nav（openApp 分发）', () => {
    render(<MobileAppGrid />)

    fireEvent.click(screen.getByTestId('mobile-launcher-open'))
    // 抽屉列表 = 全量注册表（11 条），与网格同一排序纯函数的输出。
    expect(screen.getAllByTestId('mobile-launcher-item')).toHaveLength(11)

    fireEvent.click(
      screen
        .getAllByTestId('mobile-launcher-item')
        .find((item) => item.getAttribute('data-app-id') === 'com.ageha.settings')!,
    )
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.settings',
      windowId: null,
    })
  })

  it('M3-1 第二入口共享开合：store 外部打开（上滑手势出口）→ 抽屉在场；关闭归零', async () => {
    render(<MobileAppGrid />)

    // 手势路径：MobileShell 确认回调写 store（本用例直接驱动同一出口），
    // 网格渲染位响应 store 开合挂出抽屉。
    act(() => {
      useMobileLauncherStore.getState().openLauncher()
    })
    expect(screen.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'open')

    // 关闭路径收敛到同一 store：选中应用行（openApp + onClose）后开合归零，
    // 导航照常推进。
    fireEvent.click(
      screen
        .getAllByTestId('mobile-launcher-item')
        .find((item) => item.getAttribute('data-app-id') === 'com.ageha.notes')!,
    )
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: null,
    })
    await waitFor(
      () => expect(useMobileLauncherStore.getState().open).toBe(false),
    )
  })
})
