import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetLauncherStore, useLauncherStore } from '@/store/launcher-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { Sidebar } from './Sidebar'

beforeEach(() => {
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetNotificationStore()
  resetLauncherStore()
})

describe('Sidebar（Workspace Rail）', () => {
  it('renders the rail entries in order: mark + desktop/launcher/files/notes/terminal/settings/notifications（Shell 3.0 STEP 1）', () => {
    render(<Sidebar />)

    // Ageha Mark 是装饰位（非按钮）；七个动作条目按裁决顺序排列。
    for (const name of ['桌面', '启动器', '文件管理', '记事', '终端', '设置', '通知中心']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // 商店/云同步/用户中心退出版面（入口仍在：Dock 常驻瓷贴/顶栏 Cloud/顶栏用户菜单）。
    for (const name of ['应用商店', '云同步', '用户中心']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    const order = ['desktop', 'launcher', 'files', 'notes', 'terminal', 'settings', 'notifications'].map(
      (id) => screen.getByTestId(`sidebar-${id}`),
    )
    for (let index = 1; index < order.length; index += 1) {
      const relation = order[index - 1]!.compareDocumentPosition(order[index]!)
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('keeps the Ageha Mark decorative (aria-hidden, out of the button tree)', () => {
    render(<Sidebar />)

    const mark = screen.getByTestId('sidebar').querySelector('img')
    expect(mark).not.toBeNull()
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is icon-first: labels live in os-tooltip bubbles, not as visible rows (§33.3)', () => {
    render(<Sidebar />)

    const item = screen.getByTestId('sidebar-files')
    expect(item.getAttribute('aria-label')).toBe('文件管理')
    // 气泡 tooltip 回归（窄轨名称弱化）：文本由 os-tooltip 承载。
    const tooltip = item.querySelector('.os-tooltip')
    expect(tooltip).not.toBeNull()
    expect(tooltip?.textContent).toBe('文件管理')
    expect(tooltip?.getAttribute('aria-hidden')).toBe('true')
    // 行式名称/彩瓷贴退役：无可见标签 span，无渐变底。
    expect(item.querySelector('.truncate')).toBeNull()
    expect((item.firstElementChild as HTMLElement).style.backgroundImage).toBe('')
  })

  it('uses light translucent capsules (44px round, token hovers) — no solid primary blocks', () => {
    render(<Sidebar />)

    for (const testid of ['sidebar-desktop', 'sidebar-launcher', 'sidebar-files', 'sidebar-notes', 'sidebar-terminal', 'sidebar-settings', 'sidebar-notifications']) {
      const item = screen.getByTestId(testid)
      for (const cls of ['h-11', 'w-11', 'rounded-full', 'hover:bg-surface-raised', 'active:bg-surface-elevated', 'data-[active]:bg-surface-raised']) {
        expect(item.classList.contains(cls), `${testid} missing ${cls}`).toBe(true)
      }
      // 禁实心蓝色块（用户一票否决）：条目永不挂 bg-primary。
      expect(item.classList.contains('bg-primary'), `${testid} has bg-primary`).toBe(false)
    }
  })

  it('stays an overflow-free static column — tooltips must never be clipped (§26)', () => {
    render(<Sidebar />)

    const nav = screen.getByTestId('sidebar')
    for (const cls of ['flex', 'flex-col', 'items-center', 'gap-1', 'w-[calc(var(--ag-rail-left-width)-0.5rem)]']) {
      expect(nav.classList.contains(cls), cls).toBe(true)
    }
    // overflow-y 会连带把 overflow-x 变 auto，向右伸出的 os-tooltip 被裁掉。
    expect(nav.className).not.toContain('overflow')
    expect(nav.className).not.toContain('scroll-thin')
  })

  it('toggles the shared launcher panel via the launcher store', () => {
    render(<Sidebar />)

    const launcher = screen.getByTestId('sidebar-launcher')
    expect(launcher.getAttribute('aria-expanded')).toBe('false')
    expect(launcher.getAttribute('data-active')).toBeNull()

    fireEvent.click(launcher)
    expect(useLauncherStore.getState().launcherOpen).toBe(true)
    expect(launcher.getAttribute('aria-expanded')).toBe('true')
    expect(launcher.getAttribute('data-active')).toBe('true')

    fireEvent.click(launcher)
    expect(useLauncherStore.getState().launcherOpen).toBe(false)
    expect(launcher.getAttribute('aria-expanded')).toBe('false')
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

    fireEvent.click(screen.getByTestId('sidebar-notes'))
    fireEvent.click(screen.getByTestId('sidebar-terminal'))
    fireEvent.click(screen.getByTestId('sidebar-settings'))
    const ids = useWindowStore.getState().windows.map((win) => win.appId)
    expect(ids).toContain('com.ageha.notes')
    expect(ids).toContain('com.ageha.terminal')
    expect(ids).toContain('com.ageha.settings')
  })

  it('toggles the shared notification center panel and shows the unread badge', () => {
    useNotificationStore.getState().push({ appId: 'com.ageha.notes', titleKey: 'boot.progress' })
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-unread').textContent).toBe('1')

    const bell = screen.getByTestId('sidebar-notifications')
    fireEvent.click(bell)
    expect(useNotificationStore.getState().panelOpen).toBe(true)
    expect(bell.getAttribute('aria-expanded')).toBe('true')
    expect(bell.getAttribute('data-active')).toBe('true')

    fireEvent.click(bell)
    expect(useNotificationStore.getState().panelOpen).toBe(false)
    expect(bell.getAttribute('data-active')).toBeNull()
  })
})
