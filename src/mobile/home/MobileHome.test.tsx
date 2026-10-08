import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { utcDayKey } from '@/core/eclosion/world'
import {
  resetEclosionStore,
  seedEclosionForTests,
  useEclosionStore,
} from '@/store/eclosion-store'
import { resetAppStore, useAppStore } from '@/store/app-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { MobileHome } from './MobileHome'

/**
 * M1-1 移动 Home 契约：品牌头（BrandLogo + 名称 + 双语标语）+ 时段问候
 * （分档纯函数 + 真实会话用户名）。时段用注入 now 钉死，测试不依赖挂载
 * 时刻的钟点。M1-2 起问候之后追加今日世界卡（门控归 TodayWorldCard，这里
 * 钉挂载位：羽化关默认缺席、世界落地后在 Home 容器内在场）；M1-3 起今日
 * 世界卡之后续接最近使用区（门控归 RecentApps，usage-store 空态缺席）；
 * M1-4 起最近使用之后续接应用网格（全量注册表 4 列网格，门控归
 * MobileAppGrid，空注册表缺席）。
 */

function seedUser(): void {
  seedSessionForTests({
    id: 'u1',
    username: 'e2emobile',
    createdAt: '2026-10-07T00:00:00Z',
    updatedAt: '2026-10-07T00:00:00Z',
  })
}

afterEach(() => {
  localStorage.clear()
  resetAppStore()
  resetUsageStore()
  resetSessionStore()
  resetEclosionStore()
})

describe('MobileHome', () => {
  it('品牌头：BrandLogo + 「AgehaOS」+ 标语（mobile-shell-brand 标记位随 M0 迁入）', () => {
    seedUser()
    render(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)

    expect(screen.getByTestId('mobile-home-header')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-shell-brand')).toHaveTextContent('AgehaOS')
    expect(screen.getByTestId('mobile-home-tagline')).toHaveTextContent('Your Web OS, Your Space.')
    // mark 稿 logo 是品牌头的组成部分（复用桌面 BrandLogo，label 可访问名）。
    expect(screen.getByRole('img', { name: 'AgehaOS' })).toBeInTheDocument()
  })

  it.each([
    [9, '早上好'],
    [14, '下午好'],
    [20, '晚上好'],
    [2, '晚上好'],
  ] as const)('%d 点 → 「%s」+ 会话用户名', (hour, greeting) => {
    seedUser()
    render(<MobileHome now={new Date(2026, 9, 7, hour, 0, 0)} />)
    expect(screen.getByTestId('mobile-home-greeting')).toHaveTextContent(greeting)
    expect(screen.getByTestId('mobile-home-greeting')).toHaveTextContent('，e2emobile')
  })

  it('会话缺席（防御位）：只渲染问候语，不渲染连接符与用户名', () => {
    render(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)
    const greeting = screen.getByTestId('mobile-home-greeting')
    expect(greeting).toHaveTextContent('早上好')
    expect(greeting).not.toHaveTextContent('，')
    expect(greeting).not.toHaveTextContent('e2emobile')
  })

  it('displayName 存在优先于 username', () => {
    seedSessionForTests({
      id: 'u2',
      username: 'e2emobile',
      displayName: '羽衣',
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    })
    render(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)
    expect(screen.getByTestId('mobile-home-greeting')).toHaveTextContent('，羽衣')
  })

  it('今日世界卡（M1-2）：羽化默认关 → 缺席；羽化开 + 世界落地 → 问候之后在场', () => {
    seedUser()
    const { rerender } = render(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)

    // 羽化关（默认）：整卡缺席（禁止空壳）。
    expect(screen.queryByTestId('mobile-today-world')).toBeNull()

    // 羽化开 + 世界落地（编排器 applyWorld 同形注入）：卡片挂在 Home 内、
    // 问候之后（DOM 序 = 视觉序）。
    seedEclosionForTests('u1', true)
    useEclosionStore.getState().applyWorld({
      worldDate: utcDayKey(),
      headline: '边缘推理的浪潮',
      paletteId: 'aurora-borealis',
      accentHue: 212,
      degraded: false,
      signalCount: 3,
      signals: {
        titles: ['本地智能体编排框架冲上热榜'],
        sourceName: 'GitHub Trending',
        sourceUrl: 'https://example.com/trending',
      },
      apps: [
        {
          slug: 'edge-oracle',
          name: '边缘神谕',
          hue: 268,
          tagline: '在你的浏览器里预言下一行代码',
          category: 'tools',
          window: { width: 720, height: 480 },
        },
      ],
    })
    rerender(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)

    const card = screen.getByTestId('mobile-today-world')
    expect(screen.getByTestId('mobile-home')).toContainElement(card)
    expect(screen.getByTestId('mobile-home-greeting').compareDocumentPosition(card) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('mobile-today-world-stats')).toHaveTextContent('1 款新应用')
  })

  it('最近使用区（M1-3）：今日世界卡之后续接；usage-store 空态整块缺席', () => {
    seedUser()
    resetAppStore()
    resetUsageStore()
    // 今日世界落地（同上一用例的最小注入），让卡片与最近使用同屏比序。
    seedEclosionForTests('u1', true)
    useEclosionStore.getState().applyWorld({
      worldDate: utcDayKey(),
      headline: '边缘推理的浪潮',
      paletteId: 'aurora-borealis',
      accentHue: 212,
      degraded: false,
      signalCount: 1,
      signals: {
        titles: ['本地智能体编排框架冲上热榜'],
        sourceName: 'GitHub Trending',
        sourceUrl: 'https://example.com/trending',
      },
      apps: [],
    })
    const { rerender } = render(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)

    // 默认无最近记录：整块缺席（禁止空壳）。
    expect(screen.queryByTestId('mobile-recent-apps')).toBeNull()

    // 预置最近记录（内建清单已在册）后重渲染：区块续接今日世界卡。
    useUsageStore.setState({
      recent: [
        { appId: 'com.ageha.notes', at: 1 },
        { appId: 'com.ageha.files', at: 2 },
      ],
    })
    rerender(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)

    const recents = screen.getByTestId('mobile-recent-apps')
    expect(screen.getByTestId('mobile-home')).toContainElement(recents)
    // DOM 序 = 视觉序（DESIGN.md §0.6）：今日世界卡在前、最近使用续接其后。
    expect(
      screen.getByTestId('mobile-today-world').compareDocumentPosition(recents) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getAllByTestId('mobile-recent-app')).toHaveLength(2)
  })

  it('应用网格（M1-4）：最近使用之后续接；boot 注册表全量 10 格（7 内置 + 羽化 L1）', () => {
    seedUser()
    resetUsageStore()
    // 预置最近记录（内建清单已在册），让最近使用区在场以比 DOM 序。
    useUsageStore.setState({
      recent: [
        { appId: 'com.ageha.notes', at: 1 },
        { appId: 'com.ageha.files', at: 2 },
      ],
    })
    // boot 注册表原样（resetAppStore 在 afterEach）：网格无条件在场（内置
    // 注册在 boot 之前，网格没有数据门控，空注册表才是缺席态）。
    const { rerender } = render(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)

    const grid = screen.getByTestId('mobile-app-grid')
    expect(screen.getByTestId('mobile-home')).toContainElement(grid)
    expect(screen.getAllByTestId('mobile-app-tile')).toHaveLength(10)

    // DOM 序 = 视觉序（DESIGN.md §0.6）：最近使用在前、应用网格续接其后。
    const recents = screen.getByTestId('mobile-recent-apps')
    expect(recents.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 排序契约在 MobileHome 挂载位下同样成立：首格 = 常量优先序第一位。
    expect(screen.getAllByTestId('mobile-app-tile')[0]).toHaveAttribute(
      'data-app-id',
      'com.ageha.dynamic.panel',
    )

    // 空注册表（防御位）：整块缺席且不拖垮 Home 其余区块。
    useAppStore.setState({ apps: [] })
    rerender(<MobileHome now={new Date(2026, 9, 7, 9, 0, 0)} />)
    expect(screen.queryByTestId('mobile-app-grid')).toBeNull()
    expect(screen.getByTestId('mobile-home-greeting')).toBeInTheDocument()
  })
})
