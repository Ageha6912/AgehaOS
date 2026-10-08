import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { utcDayKey } from '@/core/eclosion/world'
import {
  resetEclosionStore,
  seedEclosionForTests,
  useEclosionStore,
} from '@/store/eclosion-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'

import { MOBILE_TODAY_WORLD_TARGET_APP_ID, TodayWorldCard } from './TodayWorldCard'

/**
 * M1-2 今日世界卡契约：只消费 eclosion-store 世界摘要（真实字段统计），
 * 羽化关 / 世界未落地整卡不渲染（禁止空壳）；「查看世界」= mobile-nav-store
 * 导航推进（M1-6 前不真实开窗，落点 = 动态面板注册 appId）。
 */

/** 种当日世界摘要（编排器 applyWorld 同形；2 应用 + 3 信号）。 */
function seedWorld(options?: { signalCount?: number }): void {
  seedEclosionForTests('u-mobile-world', true)
  useEclosionStore.getState().applyWorld({
    worldDate: utcDayKey(),
    headline: '边缘推理的浪潮',
    paletteId: 'aurora-borealis',
    accentHue: 212,
    degraded: (options?.signalCount ?? 3) === 0,
    signalCount: options?.signalCount ?? 3,
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
      {
        slug: 'trend-compass',
        name: '趋势罗盘',
        hue: 210,
        tagline: '把六条趋势折叠成一张导航图',
        category: 'tools',
        window: { width: 720, height: 480 },
      },
    ],
  })
}

afterEach(() => {
  resetEclosionStore()
  resetMobileNavStore()
})

describe('TodayWorldCard', () => {
  it('羽化关（enabled=false）：即便 world 残留也整卡不渲染（禁止空壳）', () => {
    seedWorld()
    useEclosionStore.setState({ enabled: false })
    render(<TodayWorldCard />)

    expect(screen.queryByTestId('mobile-today-world')).toBeNull()
    expect(screen.queryByTestId('mobile-today-world-view')).toBeNull()
  })

  it('羽化开但世界未落地（world=null）：整卡不渲染，无「查看世界」死按钮', () => {
    seedEclosionForTests('u-mobile-world-empty', true)
    render(<TodayWorldCard />)

    expect(screen.queryByTestId('mobile-today-world')).toBeNull()
  })

  it('世界落地：标题 + 统计行用真实字段（apps.length 与 signalCount）+「查看世界」按钮', () => {
    seedWorld()
    render(<TodayWorldCard />)

    expect(screen.getByTestId('mobile-today-world')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('今日世界')
    expect(screen.getByTestId('mobile-today-world-stats')).toHaveTextContent('2 款新应用')
    expect(screen.getByTestId('mobile-today-world-stats')).toHaveTextContent('3 条趋势信号')
    expect(screen.getByTestId('mobile-today-world-view')).toHaveTextContent('查看世界')
  })

  it('纯想象降级（signalCount=0）：统计行如实显示 0 条趋势信号，卡片照常在场', () => {
    seedWorld({ signalCount: 0 })
    render(<TodayWorldCard />)

    expect(screen.getByTestId('mobile-today-world')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-today-world-stats')).toHaveTextContent('0 条趋势信号')
  })

  it('「查看世界」点击 = 导航推进到动态面板（注册 appId，过渡语义非真实开窗）', () => {
    seedWorld()
    render(<TodayWorldCard />)

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    fireEvent.click(screen.getByTestId('mobile-today-world-view'))

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: MOBILE_TODAY_WORLD_TARGET_APP_ID,
    })
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.dynamic.panel',
    })
  })

  it('重复点击幂等：nav 位置相同不产生新状态（store 等值跳过语义不受影响）', () => {
    seedWorld()
    render(<TodayWorldCard />)

    const view = screen.getByTestId('mobile-today-world-view')
    fireEvent.click(view)
    const first = useMobileNavStore.getState().nav
    fireEvent.click(view)
    expect(useMobileNavStore.getState().nav).toBe(first)
  })
})
