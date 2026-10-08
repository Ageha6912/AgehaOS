import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { utcDayKey } from '@/core/eclosion/world'
import {
  resetEclosionStore,
  seedEclosionForTests,
  useEclosionStore,
} from '@/store/eclosion-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { MobileHome } from './MobileHome'

/**
 * M1-1 移动 Home 契约：品牌头（BrandLogo + 名称 + 双语标语）+ 时段问候
 * （分档纯函数 + 真实会话用户名）。时段用注入 now 钉死，测试不依赖挂载
 * 时刻的钟点。M1-2 起问候之后追加今日世界卡（门控归 TodayWorldCard，这里
 * 钉挂载位：羽化关默认缺席、世界落地后在 Home 容器内在场）。
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
})
