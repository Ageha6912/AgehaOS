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
  it('renders the seven real-action items (§26)', () => {
    render(<Sidebar />)

    for (const name of ['桌面', '文件', '终端', '应用商店', '设置', '云同步', '通知']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
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
})
