import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBootStore } from '@/store/boot-store'
import { resetWindowStore } from '@/store/window-store'

import App from './App'

beforeEach(() => {
  vi.useFakeTimers()
  useBootStore.setState(useBootStore.getInitialState())
  resetWindowStore()
})

describe('App', () => {
  it('walks the full boot flow and lands on the desktop', () => {
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
  })
})
