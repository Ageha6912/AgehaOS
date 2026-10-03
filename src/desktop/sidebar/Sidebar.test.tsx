import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { Sidebar } from './Sidebar'

beforeEach(() => {
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetNotificationStore()
})

describe('Sidebar', () => {
  it('renders the eight real-action items in reference order (§26/§32)', () => {
    render(<Sidebar />)

    for (const name of ['桌面', '应用商店', '文件管理', '终端', '设置', '云同步', '通知中心', '用户中心']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // 参考图顺序：桌面 → 应用商店 → 文件管理 → 终端 → 设置 → 云同步 → 通知中心 → 用户中心。
    const order = ['desktop', 'store', 'files', 'terminal', 'settings', 'sync', 'notifications', 'user-center']
      .map((id) => screen.getByTestId(`sidebar-${id}`))
    expect(order.indexOf(screen.getByTestId('sidebar-desktop'))).toBeLessThan(
      order.indexOf(screen.getByTestId('sidebar-store')),
    )
    expect(order.indexOf(screen.getByTestId('sidebar-store'))).toBeLessThan(
      order.indexOf(screen.getByTestId('sidebar-files')),
    )
  })

  it('renders icon-first tiles with the label moved out of the inline flow (shell 2.0 §4.2③)', () => {
    render(<Sidebar />)

    const item = screen.getByTestId('sidebar-files')
    // icon-first：44px 方按钮居中一颗 36px 瓷贴（渐变圆角方块保留）。
    for (const cls of ['h-11', 'w-11', 'items-center', 'justify-center', 'rounded-xl', 'group']) {
      expect(item.classList.contains(cls), cls).toBe(true)
    }
    const wrapper = item.firstElementChild as HTMLElement
    expect(wrapper.classList.contains('relative')).toBe(true)
    const tile = wrapper.firstElementChild as HTMLElement
    expect(tile.style.backgroundImage).toContain('linear-gradient')
    expect(tile.classList.contains('rounded-lg')).toBe(true)
    expect(tile.classList.contains('h-9')).toBe(true)
    expect(tile.classList.contains('w-9')).toBe(true)
    // 行内文字标签退役（进 tooltip）：旧标签 span（min-w-0 truncate）不复存在。
    expect(item.querySelector('.truncate')).toBeNull()
  })

  it('shows labels as hover/focus tooltips via the os-tooltip bubble (§1③)', () => {
    render(<Sidebar />)

    const item = screen.getByTestId('sidebar-files')
    const bubble = item.querySelector('.os-tooltip') as HTMLElement | null
    expect(bubble).not.toBeNull()
    // 点亮由 index.css 的未分层 `.group:hover .os-tooltip` 规则承担：Tailwind
    // 的 group-hover:opacity-100 在 @layer utilities 里，压不过未分层的 opacity:0。
    expect(bubble!.className).toBe('os-tooltip')
    expect(item.classList.contains('group')).toBe(true)
    expect(bubble!.getAttribute('aria-hidden')).toBe('true')
    // 气泡文本 = 词条（复用 sidebar.* 双语键，零新增词条）。
    expect(bubble!.textContent).toBe('文件管理')
    // 原生 title 双轨保留（可达性 + 触屏兜底）。
    expect(item.getAttribute('title')).toBe('文件管理')
  })

  it('user center deep-links Settings to the account partition (§32)', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-user-center'))
    const settings = useWindowStore.getState().windows.find((win) => win.appId === 'com.ageha.settings')
    expect(settings).toBeDefined()
  })

  it('show-desktop minimizes every open window', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-desktop'))

    const windows = useWindowStore.getState().windows
    expect(windows.every((win) => win.state === 'minimized')).toBe(true)
  })

  it('launches apps from the rail', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-files'))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.files')

    fireEvent.click(screen.getByTestId('sidebar-terminal'))
    const ids = useWindowStore.getState().windows.map((win) => win.appId)
    expect(ids).toContain('com.ageha.terminal')
  })

  it('toggles the shared notification center panel and shows the unread badge', () => {
    useNotificationStore.getState().push({ appId: 'com.ageha.notes', titleKey: 'boot.progress' })
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-unread').textContent).toBe('1')

    fireEvent.click(screen.getByTestId('sidebar-notifications'))
    expect(useNotificationStore.getState().panelOpen).toBe(true)

    fireEvent.click(screen.getByTestId('sidebar-notifications'))
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('disables cloud sync in local mode with an explanatory hint', () => {
    render(<Sidebar />)

    const sync = screen.getByTestId('sidebar-sync')
    expect(sync).toBeDisabled()
    expect(sync.getAttribute('title')).toContain('远程模式登录后可用')
    // 状态圆点不出现（未开启）。
    expect(sync.querySelector('.bg-primary')).toBeNull()
  })

  it('renders as a static column inside the system-rails group; glass chrome lives on the group (2026-10-03 两栏连成一体)', () => {
    render(<Sidebar />)

    const nav = screen.getByTestId('sidebar')
    // 2026-10-03 裁决「两栏毛玻璃连成一体」：玻璃面（背景/边框/圆角/投影/
    // 定位）上移到 Desktop 的 system-rails 组容器——本栏只保留列布局与
    // 80px 栏宽（内容 72px），今日列不在场时组即纯左栏，外观不变。
    for (const cls of [
      'flex',
      'flex-col',
      'items-center',
      'w-[calc(var(--ag-rail-left-width)-0.5rem)]',
      'px-2',
      'py-3',
    ]) {
      expect(nav.classList.contains(cls), cls).toBe(true)
    }
    // 旧的自绘玻璃/定位退役（归组容器）；通栏贴边（Web Sidebar）残留同样
    // 不允许回归。
    for (const cls of [
      'fixed',
      'surface-glass',
      'glass-raise',
      'rounded-xl',
      'shadow-float',
      'left-4',
      'top-1/2',
      'border-r',
      'border-border-subtle',
      'bottom-0',
      'left-0',
      'rounded-2xl',
      'shadow-popover',
    ]) {
      expect(nav.classList.contains(cls), `no ${cls}`).toBe(false)
    }
    expect(nav.className).not.toContain('top-[calc')
  })
})
