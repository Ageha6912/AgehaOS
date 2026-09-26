import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/core/auth'
import { useBootStore } from '@/store/boot-store'
import { resetAppStore } from '@/store/app-store'
import { resetSessionStore, seedSessionForTests, useSessionStore } from '@/store/session-store'
import { resetWindowStore } from '@/store/window-store'

import App from './App'

const TEST_USER: User = {
  id: 'u-1',
  username: 'alice',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
}

/**
 * 开机时序（DESIGN.md §11）：引擎 2.2s 完成（fake rAF 16ms 帧距 → 完成点 ~2.24s）
 * → finishBoot 挂载目的界面 + 覆盖层退场 400ms → 收尾点 ~2.77s 卸载。
 * fake timers 连 rAF 一起接管，advanceTimersByTime 为累计时钟。
 */
const BOOT_DONE_BUT_NOT_SETTLED_MS = 1800 // 首段 800ms 后再推进：总计 2.6s，退场中
const EXIT_SETTLE_MS = 700

beforeEach(() => {
  vi.useFakeTimers()
  useBootStore.setState(useBootStore.getInitialState())
  resetWindowStore()
  resetAppStore()
  resetSessionStore()
})

describe('App', () => {
  it('walks the boot flow to the desktop for an authenticated session', () => {
    seedSessionForTests(TEST_USER)
    render(<App />)

    expect(screen.getByRole('status')).toHaveTextContent('正在启动 AgehaOS…')

    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByRole('status')).toHaveTextContent('正在加载系统资源…')

    act(() => {
      vi.advanceTimersByTime(BOOT_DONE_BUT_NOT_SETTLED_MS)
    })
    // 引擎完成：目的界面挂载，覆盖层仍盖在上层播退场。
    expect(screen.getByRole('button', { name: /开始/ })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByTestId('boot-screen')).toHaveAttribute('data-boot', 'complete')

    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLE_MS)
    })
    // 退场收尾后覆盖层卸载。
    expect(screen.queryByTestId('boot-screen')).not.toBeInTheDocument()
    expect(useBootStore.getState().layerExitDone).toBe(true)
  })

  it('shows the login screen when no session exists', () => {
    render(<App />)

    act(() => {
      vi.advanceTimersByTime(BOOT_DONE_BUT_NOT_SETTLED_MS + 800 + EXIT_SETTLE_MS)
    })

    expect(screen.getByRole('form', { name: '登录 AgehaOS' })).toBeInTheDocument()
    expect(screen.queryByTestId('boot-screen')).not.toBeInTheDocument()
  })

  it('returns to the login screen after signing out without re-showing the boot layer', () => {
    seedSessionForTests(TEST_USER)
    render(<App />)
    act(() => {
      vi.advanceTimersByTime(BOOT_DONE_BUT_NOT_SETTLED_MS + 800 + EXIT_SETTLE_MS)
    })
    expect(screen.getByRole('button', { name: /开始/ })).toBeInTheDocument()

    act(() => {
      useSessionStore.getState().logout()
    })

    expect(screen.getByRole('form', { name: '登录 AgehaOS' })).toBeInTheDocument()
    expect(screen.queryByTestId('boot-screen')).not.toBeInTheDocument()
  })
})
