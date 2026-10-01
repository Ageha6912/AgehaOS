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

  it('renders icon tiles left of labels (§32 reference layout)', () => {
    render(<Sidebar />)

    const item = screen.getByTestId('sidebar-files')
    // 行内布局：瓷贴（渐变圆角方块）在标签之前。
    expect(item.className).toContain('items-center')
    expect(item.className).not.toContain('flex-col')
    const tile = item.firstElementChild as HTMLElement
    expect(tile.style.backgroundImage).toContain('linear-gradient')
    expect(tile.className).toContain('rounded-lg')
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

  it('floats as a rounded glass card detached from the viewport edges (§31/§32)', () => {
    render(<Sidebar />)

    const nav = screen.getByTestId('sidebar')
    // 不再通顶贴边（Web Sidebar 形态退役）：圆角玻璃卡 + soft shadow + 边距。
    expect(nav.className).toContain('rounded-2xl')
    expect(nav.className).toContain('surface-glass')
    expect(nav.className).toContain('shadow-popover')
    expect(nav.className).toContain('bottom-6')
    expect(nav.className).toContain('left-2')
    expect(nav.className).toContain('desktop-chrome')
    expect(nav.className).not.toContain('border-r')
    expect(nav.className).not.toContain('bottom-0')
    expect(nav.className).not.toContain('left-0')
  })
})
