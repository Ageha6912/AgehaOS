import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuthProvider, systemAuthService } from '@/core/auth'
import type { AuthProvider } from '@/core/auth'
import { fileToAvatarDataUrl } from '@/core/auth/avatar'

import type { LoginResult } from '@/store/session-store'
import { resetSessionStore, seedSessionForTests, useSessionStore } from '@/store/session-store'

import { AccountSection } from './AccountSection'

vi.mock('@/core/auth/avatar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth/avatar')>()
  return {
    ...actual,
    fileToAvatarDataUrl: vi.fn(),
  }
})

const AVATAR = 'data:image/jpeg;base64,QUJD'

// The auth singleton keeps users across tests in this file — unique names.
let userCounter = 0

beforeEach(() => {
  resetSessionStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Registers AND signs in, so the local provider has a live session. */
async function seedUser(): Promise<void> {
  userCounter += 1
  const username = `account-section-${userCounter}`
  await systemAuthService.register(username, 'secret123')
  const { user } = await systemAuthService.login(username, 'secret123')
  seedSessionForTests(user)
}

function makeProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    register: async () => {
      throw new Error('unused')
    },
    login: async () => {
      throw new Error('unused')
    },
    logout: () => null,
    getSession: () => null,
    getUser: () => null,
    reconcile: async () => null,
    updateProfile: async () => {
      throw new Error('unused')
    },
    changePassword: async () => {},
    revokeOtherSessions: async () => 0,
    listSessions: async () => [],
    revokeSession: async () => {},
    ...overrides,
  }
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

  it('revokes other sessions after confirmation and shows the result', async () => {
    await seedUser()
    setAuthProvider(makeProvider())
    try {
      render(<AccountSection />)

      await userEvent.click(screen.getByRole('button', { name: '登出其他设备' }))
      // 危险操作二次确认（D2 审查）：取消不执行。
      const dialog = screen.getByRole('dialog', { name: '登出其他设备' })
      expect(
        within(dialog).getByText('登出该账户的全部其他会话？这些设备需要重新登录。'),
      ).toBeInTheDocument()

      await userEvent.click(within(dialog).getByRole('button', { name: '登出其他设备' }))
      await waitFor(() =>
        expect(screen.getAllByRole('status')[0]).toHaveTextContent('已登出其他设备的会话'),
      )
    } finally {
      setAuthProvider(null)
    }
  })

  it('does not revoke when the confirmation is cancelled', async () => {
    await seedUser()
    setAuthProvider(makeProvider())
    const revoke = vi.spyOn(systemAuthService, 'revokeOtherSessions')
    try {
      render(<AccountSection />)

      await userEvent.click(screen.getByRole('button', { name: '登出其他设备' }))
      await userEvent.click(
        within(screen.getByRole('dialog', { name: '登出其他设备' })).getByRole('button', {
          name: '取消',
        }),
      )
      expect(revoke).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      revoke.mockRestore()
      setAuthProvider(null)
    }
  })

  it('disables profile actions while a save is in flight (D2 审查)', async () => {
    await seedUser()
    let resolveSave: (result: LoginResult) => void = () => {}
    const pending = new Promise<LoginResult>((resolve) => {
      resolveSave = resolve
    })
    vi.spyOn(useSessionStore.getState(), 'updateProfile').mockImplementation(() => pending)

    render(<AccountSection />)
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }))

    expect(screen.getByRole('button', { name: '保存资料' })).toBeDisabled()
    resolveSave({ ok: true })
    await waitFor(() => expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled())
  })

  it('refreshes the session list after revoking other sessions (remote)', async () => {
    seedSessionForTests({ id: 'u-remote', username: 'remote', createdAt: '', updatedAt: '' })
    const revokeOtherSessions = vi.fn(async () => 1)
    setAuthProvider(
      makeProvider({
        listSessions: async () => [
          { id: 's1', device: 'Mac', createdAt: null, current: true },
          { id: 's2', device: 'iPad', createdAt: null, current: false },
        ],
        revokeOtherSessions,
      }),
    )
    try {
      render(<AccountSection />)
      await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(2))

      await userEvent.click(screen.getByRole('button', { name: '登出其他设备' }))
      await userEvent.click(
        within(screen.getByRole('dialog', { name: '登出其他设备' })).getByRole('button', {
          name: '登出其他设备',
        }),
      )

      await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1))
      // 其他会话已失效：列表只保留本设备（此前成功后列表不刷新）。
      await waitFor(() => expect(screen.getAllByTestId('session-row')).toHaveLength(1))
      expect(screen.queryByText('iPad')).toBeNull()
    } finally {
      setAuthProvider(null)
    }
  })

  it('sets and removes the avatar through the picker', async () => {
    await seedUser()
    const mocked = vi.mocked(fileToAvatarDataUrl)
    mocked.mockResolvedValue(AVATAR)
    render(<AccountSection />)

    // 无头像：占位符为用户名首字母。
    expect(screen.getByTestId('account-avatar-preview').textContent).toBe('A')

    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'me.png', { type: 'image/png' })] } })

    await waitFor(() =>
      expect(useSessionStore.getState().user?.avatar).toBe(AVATAR),
    )
    expect(screen.getByTestId('account-avatar-preview')).toHaveAttribute('src', AVATAR)
    expect(mocked).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('avatar-remove'))
    await waitFor(() => expect(useSessionStore.getState().user?.avatar).toBeUndefined())
    expect(screen.queryByTestId('avatar-remove')).toBeNull()
  })

  it('shows a friendly message when avatar processing fails', async () => {
    await seedUser()
    const { AvatarError } = await import('@/core/auth/avatar')
    vi.mocked(fileToAvatarDataUrl).mockRejectedValue(new AvatarError('avatar-too-large'))
    render(<AccountSection />)

    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'huge.png', { type: 'image/png' })] } })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('头像处理失败'))
    expect(useSessionStore.getState().user?.avatar).toBeUndefined()
  })

  it('hides device management and sync UI in local mode', async () => {
    await seedUser()
    render(<AccountSection />)

    expect(screen.queryByTestId('session-list')).toBeNull()
    expect(screen.queryByTestId('settings-sync-toggle')).toBeNull()
    // 本地 provider 恒返回 0：旧实现点击后仍提示「已登出其他设备」，
    // 实际什么都没发生。本机只有一个会话，整块不摆（D2 审查）。
    expect(screen.queryByRole('button', { name: '登出其他设备' })).toBeNull()
  })
})

describe('AccountSection admin badge (ADR 20)', () => {
  it('shows the admin badge only for admin-role users', async () => {
    await seedUser()
    // 普通用户：无徽标。
    const { unmount } = render(<AccountSection />)
    expect(screen.queryByTestId('admin-badge')).toBeNull()
    unmount()

    // admin 用户：徽标出现。
    const user = useSessionStore.getState().user
    seedSessionForTests({ ...user!, role: 'admin' })
    render(<AccountSection />)
    expect(screen.getByTestId('admin-badge')).toHaveTextContent('管理员')
  })
})
