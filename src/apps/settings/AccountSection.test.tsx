import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { systemAuthService } from '@/core/auth'

import { resetSessionStore, seedSessionForTests, useSessionStore } from '@/store/session-store'

import { AccountSection } from './AccountSection'

// The auth singleton keeps users across tests in this file — unique names.
let userCounter = 0

beforeEach(() => {
  resetSessionStore()
})

/** Registers AND signs in, so the local provider has a live session. */
async function seedUser(): Promise<void> {
  userCounter += 1
  const username = `account-section-${userCounter}`
  await systemAuthService.register(username, 'secret123')
  const { user } = await systemAuthService.login(username, 'secret123')
  seedSessionForTests(user)
}

describe('AccountSection', () => {
  it('renders the username read-only and empty profile fields', async () => {
    await seedUser()
    render(<AccountSection />)

    const username = screen.getByLabelText('用户名')
    expect(username).toHaveValue(useSessionStore.getState().user?.username ?? '')
    expect(username).toHaveAttribute('readonly')
    expect(screen.getByLabelText('昵称')).toHaveValue('')
    expect(screen.getByLabelText('邮箱')).toHaveValue('')
  })

  it('saves profile fields into the session user', async () => {
    await seedUser()
    render(<AccountSection />)

    await userEvent.type(screen.getByLabelText('昵称'), '爱丽丝')
    await userEvent.type(screen.getByLabelText('邮箱'), 'alice@example.com')
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('资料已保存'))
    expect(useSessionStore.getState().user?.displayName).toBe('爱丽丝')
    expect(useSessionStore.getState().user?.email).toBe('alice@example.com')
  })

  it('rejects a malformed email without calling the provider', async () => {
    await seedUser()
    render(<AccountSection />)

    await userEvent.type(screen.getByLabelText('邮箱'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }))

    expect(screen.getByRole('status')).toHaveTextContent('邮箱格式不正确')
    expect(useSessionStore.getState().user?.email).toBeUndefined()
  })

  it('changes the password and shows confirmation', async () => {
    await seedUser()
    render(<AccountSection />)

    await userEvent.type(screen.getByLabelText('当前密码'), 'secret123')
    await userEvent.type(screen.getByLabelText('新密码'), 'newpass123')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'newpass123')
    await userEvent.click(screen.getByRole('button', { name: '确认修改' }))

    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('密码已修改'))
  })

  it('blocks mismatched confirmation before touching the provider', async () => {
    await seedUser()
    render(<AccountSection />)

    await userEvent.type(screen.getByLabelText('当前密码'), 'secret123')
    await userEvent.type(screen.getByLabelText('新密码'), 'newpass123')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'other456')
    await userEvent.click(screen.getByRole('button', { name: '确认修改' }))

    expect(screen.getByRole('status')).toHaveTextContent('两次输入的新密码不一致')
    // Old password still valid — the provider was never called.
    const current = useSessionStore.getState().user
    expect(current).not.toBeNull()
    const login = await systemAuthService.login(current?.username ?? '', 'secret123')
    expect(login.user.username).toBe(current?.username)
  })

  it('revokes other sessions and shows the confirmation', async () => {
    await seedUser()
    render(<AccountSection />)

    await userEvent.click(screen.getByRole('button', { name: '登出其他设备' }))
    await waitFor(() =>
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('已登出其他设备的会话'),
    )
  })
})
