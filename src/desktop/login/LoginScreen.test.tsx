import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSessionStore, useSessionStore } from '@/store/session-store'

import { LoginScreen } from './LoginScreen'

// The auth service is a module singleton: give every test a unique username.
beforeEach(() => {
  resetSessionStore()
})

describe('LoginScreen', () => {
  it('renders the login form with an expired-session notice when flagged', () => {
    useSessionStore.setState({ sessionExpired: true })
    render(<LoginScreen onSuccess={vi.fn()} />)

    expect(screen.getByRole('form', { name: '登录 AgehaOS' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('上次登录已过期')
  })

  it('signs in an existing user and calls onSuccess', async () => {
    const { systemAuthService } = await import('@/core/auth')
    await systemAuthService.register('alice', 'secret123')

    const onSuccess = vi.fn()
    render(<LoginScreen onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(useSessionStore.getState().status).toBe('authenticated')
    expect(useSessionStore.getState().user?.username).toBe('alice')
  })

  it('shows an error for wrong credentials', async () => {
    const { systemAuthService } = await import('@/core/auth')
    await systemAuthService.register('carol', 'secret123')

    render(<LoginScreen onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'carol' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong!!' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误')
    expect(useSessionStore.getState().status).toBe('anonymous')
  })

  it('registers a new account, signs in and notifies success', async () => {
    const onSuccess = vi.fn()
    render(<LoginScreen onSuccess={onSuccess} />)

    fireEvent.click(screen.getByRole('button', { name: '没有账户？创建一个' }))
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(useSessionStore.getState().user?.username).toBe('bob')
  })

  it('shows a validation error when registering a duplicate username', async () => {
    const { systemAuthService } = await import('@/core/auth')
    await systemAuthService.register('dave', 'secret123')

    render(<LoginScreen onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '没有账户？创建一个' }))
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'dave' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('该用户名已被注册')
  })

  it('clears the expired notice when switching modes', () => {
    useSessionStore.setState({ sessionExpired: true })
    render(<LoginScreen onSuccess={vi.fn()} />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '没有账户？创建一个' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
