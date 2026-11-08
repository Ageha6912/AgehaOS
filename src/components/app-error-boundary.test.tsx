import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'

import { AppErrorBoundary } from './app-error-boundary'

function CrashingChild(): never {
  throw new Error('boom')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppErrorBoundary', () => {
  it('renders children when nothing crashes', () => {
    render(
      <AppErrorBoundary appId="com.ageha.notes" windowId="w1">
        <p>app content</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('app content')).toBeInTheDocument()
  })

  it('shows the recovery UI and emits app.crashed when a child throws', () => {
    const crashed = vi.fn()
    systemBus.on('app.crashed', crashed)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AppErrorBoundary appId="com.ageha.notes" windowId="w1">
        <CrashingChild />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('应用出现问题')).toBeInTheDocument()
    expect(crashed).toHaveBeenCalledWith({ appId: 'com.ageha.notes', windowId: 'w1' })
    systemBus.off('app.crashed', crashed)
  })

  it('remounts the app after clicking reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let throwing = true

    function SelfHealingChild(): string {
      if (throwing) throw new Error('boom')
      return 'app content'
    }

    render(
      <AppErrorBoundary appId="com.ageha.notes" windowId="w1">
        <SelfHealingChild />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    throwing = false
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    expect(screen.getByText('app content')).toBeInTheDocument()
  })

  it('appId / windowId 变化时清除崩溃态（跨应用复用不串台）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(
      <AppErrorBoundary appId="app.a" windowId="w1">
        <CrashingChild />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <AppErrorBoundary appId="app.b" windowId="w2">
        <p>app b content</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('app b content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
