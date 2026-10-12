import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setAuthProvider, type AuthProvider } from '@/core/auth'
import type { User } from '@/core/auth/types'
import { useLocaleStore } from '@/core/i18n'
import { SettingsApp } from './SettingsApp'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetSyncStatusForTests, useSyncStatusStore } from '@/store/sync-status-store'

import { SyncSection } from './SyncSection'

function makeUser(): User {
  return {
    id: 'u1',
    username: 'alice',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  }
}

/** jsdom 的 navigator.onLine 是原型访问器：以实例自有属性覆盖后可删还原。 */
function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  resetSessionStore()
  resetSyncStatusForTests()
  localStorage.removeItem('agehaos.sync.enabled.v1')
  useLocaleStore.getState().setLocale('zh-CN')
  setAuthProvider(null)
  setNavigatorOnline(true)
})

afterEach(() => {
  delete (window.navigator as { onLine?: unknown }).onLine
  setAuthProvider(null)
})

describe('SyncSection 降级派生（不入状态库，M4-3）', () => {
  it('本地认证模式：显示模式降级行；未登录再叠登录行；无状态块', () => {
    render(<SyncSection />)

    expect(screen.getByTestId('sync-mode-local')).toBeInTheDocument()
    expect(screen.getByTestId('sync-signed-out')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument()
    // 远程专属的「开关已关闭」行在本地模式不摆（开关入口本就不可达）。
    expect(screen.queryByTestId('sync-disabled')).not.toBeInTheDocument()
  })

  it('本地认证 + 已登录 + 开关关：只剩模式降级行', () => {
    seedSessionForTests(makeUser())
    render(<SyncSection />)

    expect(screen.getByTestId('sync-mode-local')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-signed-out')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument()
  })

  it('远程认证 + 已登录 + 开关关：提示去「账户」分区开启', () => {
    seedSessionForTests(makeUser())
    setAuthProvider({} as unknown as AuthProvider)
    render(<SyncSection />)

    expect(screen.queryByTestId('sync-mode-local')).not.toBeInTheDocument()
    expect(screen.getByTestId('sync-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument()
  })

  it('远程认证 + 未登录 + 开关开：只有登录降级行（状态块要求已登录）', () => {
    setAuthProvider({} as unknown as AuthProvider)
    localStorage.setItem('agehaos.sync.enabled.v1', '1')
    render(<SyncSection />)

    expect(screen.getByTestId('sync-signed-out')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument()
  })
})

describe('SyncSection 状态展示（状态库真实流转，M4-3）', () => {
  beforeEach(() => {
    seedSessionForTests(makeUser())
    setAuthProvider({} as unknown as AuthProvider)
    localStorage.setItem('agehaos.sync.enabled.v1', '1')
  })

  it('idle 且从未成功：尚未同步', () => {
    render(<SyncSection />)
    expect(screen.getByTestId('sync-status-line')).toHaveTextContent('尚未同步')
  })

  it('idle 且有成功时刻：上次同步成功 + 时间', () => {
    useSyncStatusStore.getState().completeSyncCycle(Date.UTC(2026, 9, 11, 8, 0, 0))
    render(<SyncSection />)
    expect(screen.getByTestId('sync-status-line')).toHaveTextContent(/上次同步成功：/)
    // toLocaleString 的时间必然含数字。
    expect(screen.getByTestId('sync-status-line').textContent).toMatch(/\d/)
  })

  it('syncing：正在同步', () => {
    useSyncStatusStore.getState().beginSyncCycle()
    render(<SyncSection />)
    expect(screen.getByTestId('sync-status-line')).toHaveTextContent('正在同步')
  })

  it('error：上次同步失败 + 失败时刻；有历史成功时并列「上次成功」副行', () => {
    useSyncStatusStore.getState().completeSyncCycle(Date.UTC(2026, 9, 11, 8, 0, 0))
    useSyncStatusStore.getState().beginSyncCycle()
    useSyncStatusStore.getState().failSyncCycle(Date.UTC(2026, 9, 11, 9, 0, 0))

    render(<SyncSection />)

    expect(screen.getByTestId('sync-status-line')).toHaveTextContent(/上次同步失败：/)
    expect(screen.getByTestId('sync-last-success-line')).toHaveTextContent(/上次同步成功：/)
  })

  it('离线（navigator.onLine=false）如实显示离线行，恢复联网后消失', () => {
    setNavigatorOnline(false)
    render(<SyncSection />)
    expect(screen.getByTestId('sync-offline')).toBeInTheDocument()

    act(() => {
      setNavigatorOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByTestId('sync-offline')).not.toBeInTheDocument()
  })

  it('开关经 SYNC_TOGGLE_EVENT 翻转时降级/状态块实时切换', () => {
    render(<SyncSection />)
    expect(screen.getByTestId('sync-status')).toBeInTheDocument()

    act(() => {
      localStorage.removeItem('agehaos.sync.enabled.v1')
      window.dispatchEvent(new Event('agehaos:sync-toggled'))
    })
    expect(screen.getByTestId('sync-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument()
  })
})

describe('SettingsApp「同步」分区入口', () => {
  it('侧栏登记「同步」分区且点击可进入（桌面宽容器）', () => {
    render(<SettingsApp />)
    fireEvent.click(screen.getByRole('button', { name: '同步' }))
    expect(screen.getByRole('region', { name: '同步' })).toBeInTheDocument()
  })
})
