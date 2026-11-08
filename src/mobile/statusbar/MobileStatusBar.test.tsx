import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetMobileSheetStore } from '@/store/mobile-sheet-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { MobileStatusBar } from './MobileStatusBar'

/**
 * M1-1 状态栏契约：真实数据源 + 「能力不可用即整体隐藏」（DESIGN.md
 * §0.5 拒绝装饰性谎言）。jsdom 不带 getBattery / connection，正好当作
 * 「不可用」基线；可用档用伪造 navigator 能力注入。
 *
 * M2-2 增补：通知铃铛 + 未读徽标契约（全状态栏首个可点目标）——徽标 =
 * notification-store 未读数（unreadCount），>9 折叠 9+；点按开 Bottom
 * Sheet（aria-expanded 反射）。
 *
 * M2-3 增补：控制中心入口按钮（铃铛旁最右位）——i18n 可访问名 + dialog
 * 语义 + 44×44 命中区（::after 下延同款）+ 关闭回焦。
 */

function grantNavigator(prop: 'getBattery' | 'connection', value: unknown): void {
  Object.defineProperty(window.navigator, prop, { configurable: true, value })
}

function pushWorldReady(): string {
  return useNotificationStore.getState().push({
    appId: 'system',
    titleKey: 'notification.title.worldReady',
    bodyKey: 'notification.body.worldReady',
  })
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'getBattery')
  Reflect.deleteProperty(window.navigator, 'connection')
  Reflect.deleteProperty(window.navigator, 'onLine')
  resetSessionStore()
  resetNotificationStore()
  resetMotionPrefsStore()
  resetMobileSheetStore()
  localStorage.clear()
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

describe('MobileStatusBar 通知铃铛（M2-2）', () => {
  it('无未读：铃铛在场且未展开，徽标缺席（零未读零装饰）', () => {
    render(<MobileStatusBar />)
    const bell = screen.getByTestId('mobile-notification-bell')
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.queryByTestId('mobile-notification-badge')).toBeNull()
  })

  it('徽标计数 = 未读数（unreadCount），>9 折叠 9+，全部已读后徽标消失', () => {
    render(<MobileStatusBar />)
    act(() => {
      pushWorldReady()
    })
    expect(screen.getByTestId('mobile-notification-badge')).toHaveTextContent('1')
    act(() => {
      for (let index = 0; index < 11; index += 1) pushWorldReady()
    })
    expect(screen.getByTestId('mobile-notification-badge')).toHaveTextContent('9+')
    act(() => {
      useNotificationStore.getState().markAllRead()
    })
    expect(screen.queryByTestId('mobile-notification-badge')).toBeNull()
  })

  it('点按铃铛开通知中心 Bottom Sheet（aria-expanded 反射，dialog 角色在场）', () => {
    render(<MobileStatusBar />)
    fireEvent.click(screen.getByTestId('mobile-notification-bell'))
    expect(screen.getByTestId('mobile-notification-bell')).toHaveAttribute('aria-expanded', 'true')
    const sheet = screen.getByTestId('mobile-notification-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAttribute('aria-label', '通知中心')
  })
})

describe('MobileStatusBar 控制中心入口（M2-3）', () => {
  it('入口按钮：调节图标位 + i18n 可访问名 + dialog 语义，默认收起', () => {
    render(<MobileStatusBar />)
    const entry = screen.getByTestId('mobile-control-center-entry')
    expect(entry).toHaveAttribute('aria-label', '控制中心')
    expect(entry).toHaveAttribute('aria-haspopup', 'dialog')
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mobile-control-center')).toBeNull()
  })

  it('点按开控制中心 sheet；backdrop 关闭回焦入口（§0.4 移动口径）', async () => {
    render(<MobileStatusBar />)
    fireEvent.click(screen.getByTestId('mobile-control-center-entry'))
    expect(screen.getByTestId('mobile-control-center-entry')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const sheet = screen.getByTestId('mobile-control-center-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAttribute('aria-label', '控制中心')

    // backdrop 关闭 → 播完退场帧卸载，焦点回入口按钮。
    fireEvent.click(screen.getByTestId('mobile-control-center-backdrop'))
    expect(screen.getByTestId('mobile-control-center-entry')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByTestId('mobile-control-center-entry')).toHaveFocus()
    await waitFor(() => expect(screen.queryByTestId('mobile-control-center')).toBeNull())
  })

  it('触控纪律：入口命中区 44×44（h-11 w-11 + ::after 下延，与铃铛同款）', () => {
    render(<MobileStatusBar />)
    const entry = screen.getByTestId('mobile-control-center-entry')
    expect(entry.className).toContain('h-11')
    expect(entry.className).toContain('w-11')
    expect(entry.className).toContain('after:h-11')
  })
})
