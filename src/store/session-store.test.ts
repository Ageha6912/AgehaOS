import { describe, it, expect, beforeEach, vi } from 'vitest'

import { setAuthProvider, systemAuthService } from '@/core/auth'
import type { AuthProvider } from '@/core/auth'
import { systemBus } from '@/core/events'

import { resetSessionStore, seedSessionForTests, useSessionStore } from './session-store'

/** Only reconcile is meaningful; every other call is a test bug. */
function makeStubProvider(reconcile: AuthProvider['reconcile']): AuthProvider {
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
    reconcile,
    updateProfile: async () => {
      throw new Error('unused')
    },
    changePassword: async () => {},
    revokeOtherSessions: async () => 0,
    listSessions: async () => [],
    revokeSession: async () => {},
  }
}

// Unique usernames per test: the auth singleton keeps users for the file.
beforeEach(() => {
  resetSessionStore()
})

describe('session-store', () => {
  it('starts anonymous without a session', () => {
    expect(useSessionStore.getState().status).toBe('anonymous')
    expect(useSessionStore.getState().user).toBeNull()
  })

  it('logs in and holds the user', async () => {
    await systemAuthService.register('alice-session', 'secret123')

    const result = await useSessionStore.getState().login('alice-session', 'secret123')

    expect(result.ok).toBe(true)
    expect(useSessionStore.getState().status).toBe('authenticated')
    expect(useSessionStore.getState().user?.username).toBe('alice-session')
  })

  it('reports auth errors on login failure', async () => {
    const result = await useSessionStore.getState().login('ghost', 'whatever')

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('invalid-credentials')
    expect(useSessionStore.getState().status).toBe('anonymous')
  })

  it('registers and signs in automatically', async () => {
    const result = await useSessionStore.getState().register('bob-session', 'secret123')

    expect(result.ok).toBe(true)
    expect(useSessionStore.getState().status).toBe('authenticated')
    expect(useSessionStore.getState().user?.username).toBe('bob-session')
  })

  it('logs out and clears the user', async () => {
    await useSessionStore.getState().register('carol-session', 'secret123')

    await useSessionStore.getState().logout()

    expect(useSessionStore.getState().status).toBe('anonymous')
    expect(useSessionStore.getState().user).toBeNull()
  })

  it('updates profile fields and reflects them in the session user', async () => {
    await systemAuthService.register('profile-session', 'secret123')
    const { user } = await systemAuthService.login('profile-session', 'secret123')
    seedSessionForTests(user)

    const result = await useSessionStore.getState().updateProfile({
      displayName: '普罗菲尔',
      email: 'profile@example.com',
    })
    expect(result.ok).toBe(true)
    expect(useSessionStore.getState().user?.displayName).toBe('普罗菲尔')
    expect(useSessionStore.getState().user?.email).toBe('profile@example.com')

    const cleared = await useSessionStore.getState().updateProfile({ displayName: null })
    expect(cleared.ok).toBe(true)
    expect(useSessionStore.getState().user?.displayName).toBeUndefined()
  })

  it('changes the password locally and rejects a wrong current one', async () => {
    await systemAuthService.register('pw-session', 'secret123')
    const { user } = await systemAuthService.login('pw-session', 'secret123')
    seedSessionForTests(user)

    const wrong = await useSessionStore.getState().changePassword('wrong!!1', 'newpass123')
    expect(wrong.ok).toBe(false)
    expect(wrong.error?.code).toBe('invalid-credentials')

    const changed = await useSessionStore.getState().changePassword('secret123', 'newpass123')
    expect(changed.ok).toBe(true)

    // Old password no longer logs in; new one does (unique usernames avoid
    // the auth singleton's cross-test user table).
    const relogin = await systemAuthService.login('pw-session', 'newpass123')
    expect(relogin.user.username).toBe('pw-session')
    await expect(systemAuthService.login('pw-session', 'secret123')).rejects.toMatchObject({
      code: 'invalid-credentials',
    })
  })

  it('revokes other sessions (local mode keeps a no-op count)', async () => {
    await systemAuthService.register('revoke-session', 'secret123')
    const { user } = await systemAuthService.login('revoke-session', 'secret123')
    seedSessionForTests(user)
    const result = await useSessionStore.getState().revokeOtherSessions()
    expect(result.ok).toBe(true)
    expect(result.revoked).toBe(0)
  })

  it('reconciles against the provider: live session keeps the user', async () => {
    seedSessionForTests({ id: 'u9', username: 'remote-reconcile', createdAt: '', updatedAt: '' })
    setAuthProvider(makeStubProvider(async () => ({
      id: 'u9',
      username: 'remote-reconcile',
      createdAt: '',
      updatedAt: '',
    })))
    try {
      await useSessionStore.getState().reconcile()
      expect(useSessionStore.getState().status).toBe('authenticated')
      expect(useSessionStore.getState().user?.id).toBe('u9')
    } finally {
      setAuthProvider(null)
    }
  })

  it('reconcile broadcasts user.login exactly once when reviving an anonymous boot', async () => {
    // 远程模式刷新场景：store 初始化时无用户（Cookie 会话待确认），
    // reconcile 恢复会话必须补广播 user.login——壁纸/同步登录钩子靠它触发。
    const emit = vi.spyOn(systemBus, 'emit')
    setAuthProvider(makeStubProvider(async () => ({
      id: 'u9',
      username: 'remote-reconcile',
      createdAt: '',
      updatedAt: '',
    })))
    try {
      await useSessionStore.getState().reconcile()
      expect(useSessionStore.getState().user?.id).toBe('u9')
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledWith('user.login', { userId: 'u9' })

      // 已是认证态的二次 reconcile 不再广播（本地恢复路径不重复触发钩子）。
      emit.mockClear()
      await useSessionStore.getState().reconcile()
      expect(emit).not.toHaveBeenCalled()
    } finally {
      emit.mockRestore()
      setAuthProvider(null)
    }
  })

  it('reconciles against the provider: dead session signs out', async () => {
    seedSessionForTests({ id: 'u9', username: 'remote-reconcile', createdAt: '', updatedAt: '' })
    setAuthProvider(makeStubProvider(async () => null))
    try {
      await useSessionStore.getState().reconcile()
      expect(useSessionStore.getState().status).toBe('anonymous')
      expect(useSessionStore.getState().user).toBeNull()
    } finally {
      setAuthProvider(null)
    }
  })
})
