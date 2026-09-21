import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useBootStore } from '@/store/boot-store'

import { BootScreen } from './BootScreen'

beforeEach(() => {
  vi.useFakeTimers()
  useBootStore.setState(useBootStore.getInitialState())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BootScreen', () => {
  it('shows the booting status first', () => {
    render(<BootScreen />)

    expect(screen.getByRole('heading', { name: 'AgehaOS' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在启动 AgehaOS…')
  })

  it('advances through the boot phases automatically', () => {
    render(<BootScreen />)

    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByRole('status')).toHaveTextContent('正在加载系统资源…')
    expect(useBootStore.getState().phase).toBe('loading')

    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(useBootStore.getState().phase).toBe('ready')
  })

  it('reports the ready phase without scheduling another step', () => {
    useBootStore.getState().setPhase('ready')

    render(<BootScreen />)

    expect(screen.getByRole('status')).toHaveTextContent('启动完成')
    expect(vi.getTimerCount()).toBe(0)
  })
})
