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
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByRole('button', { name: /开始/ })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('shows the login screen when no session exists', () => {
    render(<App />)

    act(() => {
      vi.advanceTimersByTime(800)
    })
    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(screen.getByRole('form', { name: '登录 AgehaOS' })).toBeInTheDocument()
  })

  it('returns to the login screen after signing out', () => {
    seedSessionForTests(TEST_USER)
    render(<App />)
    act(() => {
      vi.advanceTimersByTime(800)
    })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByRole('button', { name: /开始/ })).toBeInTheDocument()

    act(() => {
      useSessionStore.getState().logout()
    })

    expect(screen.getByRole('form', { name: '登录 AgehaOS' })).toBeInTheDocument()
  })
})
