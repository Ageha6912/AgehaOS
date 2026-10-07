import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { MobileHome } from './MobileHome'

/**
 * M1-1 移动 Home 契约：品牌头（BrandLogo + 名称 + 双语标语）+ 时段问候
 * （分档纯函数 + 真实会话用户名）。时段用注入 now 钉死，测试不依赖挂载
 * 时刻的钟点。
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
})
