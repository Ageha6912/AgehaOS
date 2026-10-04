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

  it('renders icon-left label-right rows（2026-10-03 裁决「名称在图标右方」）', () => {
    render(<Sidebar />)

    const item = screen.getByTestId('sidebar-files')
    // 行式条目：全宽行 + 图标（36px 瓷贴保留）在左 + 名称在右。
    for (const cls of ['w-full', 'items-center', 'gap-3', 'rounded-xl', 'px-2', 'py-1.5']) {
      expect(item.classList.contains(cls), cls).toBe(true)
    }
    const wrapper = item.firstElementChild as HTMLElement
    expect(wrapper.classList.contains('relative')).toBe(true)
    expect(wrapper.classList.contains('shrink-0')).toBe(true)
    const tile = wrapper.firstElementChild as HTMLElement
    expect(tile.style.backgroundImage).toContain('linear-gradient')
    expect(tile.classList.contains('rounded-lg')).toBe(true)
    expect(tile.classList.contains('h-9')).toBe(true)
    expect(tile.classList.contains('w-9')).toBe(true)
    // 名称常显（文本 = sidebar.files 词条，13px 截断式）。
    const label = item.querySelector('.truncate') as HTMLElement
    expect(label).not.toBeNull()
    expect(label.textContent).toBe('文件管理')
    expect(label.className).toContain('text-[13px]')
  })

  it('retires the tooltip bubble—labels are always visible（2026-10-03 裁决）', () => {
    render(<Sidebar />)

    const item = screen.getByTestId('sidebar-files')
    // 名称常显后自绘气泡退役；原生 title 保留承载云同步组合提示。
    expect(item.querySelector('.os-tooltip')).toBeNull()
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
    // 2026-10-03 裁决「单栏拉长」：名称右置行式条目，列内容随组容器高度
    // 拉长（内部滚动兜底短视口）；150px 栏宽容纳「图标 + 四字名称」。
    for (const cls of [
      'flex',
      'flex-col',
      'w-[calc(var(--ag-rail-left-width)-0.5rem)]',
      'px-2',
      'py-3',
      'gap-1',
      'overflow-y-auto',
      'scroll-thin',
      'min-h-0',
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
      'flex-row-reverse',
      'items-stretch',
      'top-1/2',
    ]) {
      expect(nav.classList.contains(cls), `no ${cls}`).toBe(false)
    }
    expect(nav.className).not.toContain('top-[calc')
  })
})
