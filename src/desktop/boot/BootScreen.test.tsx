import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useBootStore } from '@/store/boot-store'
import { resetSessionStore, seedSessionForTests, useSessionStore } from '@/store/session-store'

import { BootScreen } from './BootScreen'

const TEST_USER = {
  id: 'u-1',
  username: 'alice',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
}

beforeEach(() => {
  vi.useFakeTimers()
  useBootStore.setState(useBootStore.getInitialState())
})

afterEach(() => {
  vi.useRealTimers()
  resetSessionStore()
})

describe('BootScreen', () => {
  it('shows the booting status first', () => {
    render(<BootScreen />)

    expect(screen.getByRole('heading', { name: 'AgehaOS' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在启动 AgehaOS…')
  })

  it('lands on the desktop when a session exists', () => {
    seedSessionForTests(TEST_USER)
    render(<BootScreen />)

    act(() => {
      vi.advanceTimersByTime(800)
    })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(useBootStore.getState().phase).toBe('ready')
  })

  it('lands on the login screen without a session', () => {
    resetSessionStore()
    render(<BootScreen />)

    act(() => {
      vi.advanceTimersByTime(800)
    })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(useBootStore.getState().phase).toBe('login')
    expect(screen.getByRole('status')).toHaveTextContent('请登录以继续')
  })

  it('reports the ready phase without scheduling another step', () => {
    useBootStore.getState().setPhase('ready')

    render(<BootScreen />)

    expect(screen.getByRole('status')).toHaveTextContent('启动完成')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the session store untouched during boot rendering', () => {
    seedSessionForTests(TEST_USER)
    render(<BootScreen />)

    expect(useSessionStore.getState().status).toBe('authenticated')
  })
})
