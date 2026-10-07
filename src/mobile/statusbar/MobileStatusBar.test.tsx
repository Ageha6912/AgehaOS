import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { MobileStatusBar } from './MobileStatusBar'

/**
 * M1-1 状态栏契约：真实数据源 + 「能力不可用即整体隐藏」（DESIGN.md
 * §0.5 拒绝装饰性谎言）。jsdom 不带 getBattery / connection，正好当作
 * 「不可用」基线；可用档用伪造 navigator 能力注入。
 */

function grantNavigator(prop: 'getBattery' | 'connection', value: unknown): void {
  Object.defineProperty(window.navigator, prop, { configurable: true, value })
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'getBattery')
  Reflect.deleteProperty(window.navigator, 'connection')
  Reflect.deleteProperty(window.navigator, 'onLine')
  resetSessionStore()
})

describe('MobileStatusBar 能力不可用即隐藏', () => {
  it('jsdom 裸环境：电池与网络缺席渲染，时钟与用户名在场', async () => {
    seedSessionForTests({
      id: 'u1',
      username: 'e2emobile',
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    })
    render(<MobileStatusBar />)

    expect(screen.getByTestId('mobile-statusbar-clock')).toHaveTextContent(/^\d{2}:\d{2}$/)
    expect(screen.getByTestId('mobile-statusbar-user')).toHaveTextContent('e2emobile')
    expect(screen.queryByTestId('mobile-statusbar-battery')).toBeNull()
    expect(screen.queryByTestId('mobile-statusbar-network')).toBeNull()
  })

  it('getBattery 可用 → 真实电量百分比（0.87 → 87%）', async () => {
    grantNavigator('getBattery', () =>
      Promise.resolve({
        level: 0.87,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    render(<MobileStatusBar />)

    await waitFor(() =>
      expect(screen.getByTestId('mobile-statusbar-battery')).toHaveTextContent('87%'),
    )
  })

  it('connection.effectiveType 可读 → 在线显示读数；掉线切 i18n 离线文案', async () => {
    grantNavigator('connection', {
      effectiveType: '4g',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const { rerender } = render(<MobileStatusBar />)
    expect(screen.getByTestId('mobile-statusbar-network')).toHaveTextContent('4g')

    // 掉线是读数翻转不是能力丢失：网络项仍在，文案切「离线」。
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    rerender(<MobileStatusBar />)
    await waitFor(() =>
      expect(screen.getByTestId('mobile-statusbar-network')).toHaveTextContent('离线'),
    )
  })

  it('用户 displayName 存在优先于 username（与桌面 UserMenu 同口径）', () => {
    seedSessionForTests({
      id: 'u2',
      username: 'e2emobile',
      displayName: '羽衣',
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    })
    render(<MobileStatusBar />)
    expect(screen.getByTestId('mobile-statusbar-user')).toHaveTextContent('羽衣')
  })
})
