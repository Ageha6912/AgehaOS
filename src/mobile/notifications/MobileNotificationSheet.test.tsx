import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetMotionPrefsStore, useMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'

import { MobileNotificationSheet } from './MobileNotificationSheet'

/**
 * M2-2 移动通知中心 Bottom Sheet 契约：
 * - 列表渲染 = notification-store 既有条目（标题/正文/时间；正文经
 *   formatMessage 填充占位参数），dialog 角色 + i18n 可访问名；
 * - 打开即 markAllRead（徽标语义 =「尚未在中心过目」）；查看期间新 push
 *   保持未读（data-read 反射）；
 * - 单条清除 / 全部清空 = store.remove / store.clear 分发；清空按钮只在
 *   有通知时在场（禁止空态死按钮）；空态文案 notification.empty；
 * - 关闭 = backdrop 点击 / Esc（document 捕获阶段）回调 onClose；open→false
 *   播完退场帧（data-state='leaving' + aria-hidden）再卸载；
 * - 动效尊重 = motion-prefs 转场关档追加 .mobile-notification-static；
 * - 触控纪律 = 清除/清空命中区 ≥44×44（§35.3）。
 * M4-2 通知点击跳转：带 targetAppId 且目标在册 → 行主体跳转按钮，点按 =
 * markRead + mobile-nav-store openApp（最近任务模型：无记录新开过渡帧 /
 * 有活记录切回既有窗口）+ onClose 关 sheet；无 targetAppId 或目标已注销 →
 * 纯展示整条不可点（不伪造，判定在 notification-nav.ts 纯函数）。
 */

/** 两条样例通知（bridge 真实键：应用崩溃 + 世界就绪；序 = push 序）。 */
function pushTwo(): Array<string> {
  const ids: Array<string> = []
  act(() => {
    ids.push(
      useNotificationStore.getState().push({
        appId: 'system',
        titleKey: 'notification.title.worldReady',
        bodyKey: 'notification.body.worldReady',
      }),
    )
    ids.push(
      useNotificationStore.getState().push({
        appId: 'system',
        titleKey: 'notification.title.appCrashed',
        bodyKey: 'notification.body.appCrashed',
        bodyParams: { app: '计算器' },
        priority: 'critical',
      }),
    )
  })
  return ids
}

beforeEach(() => {
  localStorage.clear()
  resetNotificationStore()
  resetMotionPrefsStore()
  resetMobileNavStore()
  // 跳转目标的在册门控走真实注册表（getAppManifest），注册内置清单。
  resetAppStore()
})

describe('MobileNotificationSheet', () => {
  it('列表渲染：dialog 角色 + i18n 标题/正文（占位参数填充）/时间', () => {
    pushTwo()
    render(<MobileNotificationSheet open onClose={vi.fn()} />)

    const sheet = screen.getByTestId('mobile-notification-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet).toHaveAttribute('aria-label', '通知中心')

    const items = screen.getAllByTestId('mobile-notification-item')
    expect(items).toHaveLength(2)
    // 最新在前（store push 序反序渲染）。
    expect(items[0]).toHaveTextContent('应用出现问题')
    expect(items[0]).toHaveTextContent('「计算器」已停止响应，系统其余部分不受影响。')
    expect(items[1]).toHaveTextContent('今日世界已就绪')
    for (const item of items) {
      expect(item.textContent).toMatch(/\d{1,2}:\d{2}/)
    }
    expect(screen.getByTestId('mobile-notification-list')).toBeInTheDocument()
  })

  it('打开即 markAllRead 分发；查看期间新 push 保持未读（data-read 反射）', () => {
    pushTwo()
    render(<MobileNotificationSheet open onClose={vi.fn()} />)

    // 打开瞬间消化既有未读（effect 同步分发）。
    for (const item of useNotificationStore.getState().items) {
      expect(item.read).toBe(true)
    }
    expect(screen.getAllByTestId('mobile-notification-item')[0]).toHaveAttribute(
      'data-read',
      'true',
    )

    // 查看期间到达的新通知保持未读（打开路径不重跑）。
    act(() => {
      useNotificationStore.getState().push({
        appId: 'system',
        titleKey: 'notification.title.wallpaperFailed',
        bodyKey: 'notification.body.wallpaperFailed',
      })
    })
    const items = screen.getAllByTestId('mobile-notification-item')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAttribute('data-read', 'false')
    expect(useNotificationStore.getState().items[0]?.read).toBe(false)
  })

  it('单条清除分发 store.remove：只移除目标条目，其余保留', () => {
    const ids = pushTwo()
    render(<MobileNotificationSheet open onClose={vi.fn()} />)

    const items = screen.getAllByTestId('mobile-notification-item')
    fireEvent.click(within(items[0]).getByTestId('mobile-notification-remove'))

    const remaining = useNotificationStore.getState().items
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(ids[0])
    expect(screen.getAllByTestId('mobile-notification-item')).toHaveLength(1)
  })

  it('清空按钮分发 store.clear：列表清空 → 空态文案在场、清空按钮退场', () => {
    pushTwo()
    render(<MobileNotificationSheet open onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId('mobile-notification-clear'))

    expect(useNotificationStore.getState().items).toHaveLength(0)
    expect(screen.getByTestId('mobile-notification-empty')).toHaveTextContent('暂无通知')
    expect(screen.queryByTestId('mobile-notification-clear')).toBeNull()
    expect(screen.queryByTestId('mobile-notification-list')).toBeNull()
  })

  it('空态：零通知时渲染 notification.empty 文案，无清空按钮（禁止死按钮）', () => {
    render(<MobileNotificationSheet open onClose={vi.fn()} />)
    expect(screen.getByTestId('mobile-notification-empty')).toHaveTextContent('暂无通知')
    expect(screen.queryByTestId('mobile-notification-clear')).toBeNull()
    expect(screen.queryByTestId('mobile-notification-item')).toBeNull()
  })

  it('关闭路径：backdrop 点击与 Esc 都回调 onClose；退场帧播完再卸载', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<MobileNotificationSheet open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('mobile-notification-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)

    // 持有方置 open=false 后：退场帧（aria-hidden + pointer-events 在组件侧
    // class），播完 200ms 卸载。
    rerender(<MobileNotificationSheet open={false} onClose={onClose} />)
    const root = screen.getByTestId('mobile-notification-center')
    expect(root).toHaveAttribute('data-state', 'leaving')
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root.className).toContain('pointer-events-none')
    await waitFor(() => expect(screen.queryByTestId('mobile-notification-center')).toBeNull())
  })

  it('触控纪律：清除与清空按钮命中区 ≥44×44（§35.3）', () => {
    pushTwo()
    render(<MobileNotificationSheet open onClose={vi.fn()} />)
    for (const button of screen.getAllByTestId('mobile-notification-remove')) {
      expect(button.className).toContain('h-11')
      expect(button.className).toContain('w-11')
    }
    expect(screen.getByTestId('mobile-notification-clear').className).toContain('min-h-[44px]')
  })

  it('动效尊重：motion-prefs 转场关档追加 .mobile-notification-static 直切', () => {
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    render(<MobileNotificationSheet open onClose={vi.fn()} />)
    expect(screen.getByTestId('mobile-notification-center').className).toContain(
      'mobile-notification-static',
    )
  })

  it('M4-2 跳转：带 targetAppId 且在册 → 行主体为按钮，点按 = markRead + openApp + onClose', () => {
    const onClose = vi.fn()
    act(() => {
      useNotificationStore.getState().push({
        appId: 'system',
        targetAppId: 'com.ageha.notes',
        titleKey: 'notification.title.appCrashed',
        bodyKey: 'notification.body.appCrashed',
        bodyParams: { app: 'Notes' },
        priority: 'critical',
      })
    })
    render(<MobileNotificationSheet open onClose={onClose} />)

    const item = screen.getByTestId('mobile-notification-item')
    expect(item).toHaveAttribute('data-navigable', 'true')
    const open = within(item).getByTestId('mobile-notification-open')
    expect(open).toHaveAttribute('data-target-app-id', 'com.ageha.notes')
    // 可访问名带词典键「打开」尾注（sr-only），不是字符串拼接。
    expect(within(open).getByText('打开')).toBeInTheDocument()
    expect(open.className).toContain('min-h-[44px]')

    fireEvent.click(open)

    expect(useNotificationStore.getState().items[0]?.read).toBe(true)
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: null,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('M4-2 复用：目标已有活窗口 → openApp 切回既有 windowId（最近任务单实例）', () => {
    act(() => {
      useNotificationStore.getState().push({
        appId: 'system',
        targetAppId: 'com.ageha.notes',
        titleKey: 'notification.title.appCrashed',
        bodyKey: 'notification.body.appCrashed',
        bodyParams: { app: 'Notes' },
      })
      useMobileNavStore.setState({
        apps: [{ appId: 'com.ageha.notes', windowId: 'w-live', openedAt: 1 }],
      })
    })
    const onClose = vi.fn()
    render(<MobileNotificationSheet open onClose={onClose} />)

    fireEvent.click(within(screen.getByTestId('mobile-notification-item')).getByTestId('mobile-notification-open'))

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'w-live',
    })
  })

  it('M4-2 退化：targetAppId 已注销 → 纯展示无跳转按钮（不伪造），nav 不动', () => {
    act(() => {
      useNotificationStore.getState().push({
        appId: 'system',
        targetAppId: 'com.ageha.eclosion.gone',
        titleKey: 'notification.title.eclosionAppFailed',
        bodyKey: 'notification.body.eclosionAppFailedNoFallback',
        bodyParams: { app: '已注销应用' },
      })
    })
    const onClose = vi.fn()
    render(<MobileNotificationSheet open onClose={onClose} />)

    const item = screen.getByTestId('mobile-notification-item')
    expect(item).toHaveAttribute('data-navigable', 'false')
    expect(within(item).queryByTestId('mobile-notification-open')).toBeNull()
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('M4-2 纯展示：无 targetAppId 的通知（载荷无 appId）整条不可点', () => {
    pushTwo()
    render(<MobileNotificationSheet open onClose={vi.fn()} />)

    for (const item of screen.getAllByTestId('mobile-notification-item')) {
      expect(item).toHaveAttribute('data-navigable', 'false')
      expect(within(item).queryByTestId('mobile-notification-open')).toBeNull()
    }
  })
})
