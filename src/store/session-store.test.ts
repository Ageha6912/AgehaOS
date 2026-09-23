import { describe, it, expect, beforeEach } from 'vitest'

import { setAuthProvider, systemAuthService } from '@/core/auth'

import { resetSessionStore, seedSessionForTests, useSessionStore } from './session-store'

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
    setAuthProvider({
      register: async () => {
        throw new Error('unused')
      },
      login: async () => {
        throw new Error('unused')
      },
      logout: () => null,
      getSession: () => null,
      getUser: () => null,
      reconcile: async () => ({
        id: 'u9',
        username: 'remote-reconcile',
        createdAt: '',
        updatedAt: '',
      }),
      updateProfile: async () => {
        throw new Error('unused')
      },
      changePassword: async () => {},
      revokeOtherSessions: async () => 0,
      listSessions: async () => [],
      revokeSession: async () => {},
    })
    try {
      await useSessionStore.getState().reconcile()
      expect(useSessionStore.getState().status).toBe('authenticated')
      expect(useSessionStore.getState().user?.id).toBe('u9')
    } finally {
      setAuthProvider(null)
    }
  })

  it('reconciles against the provider: dead session signs out', async () => {
    seedSessionForTests({ id: 'u9', username: 'remote-reconcile', createdAt: '', updatedAt: '' })
    setAuthProvider({
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
    })
    try {
      await useSessionStore.getState().reconcile()
      expect(useSessionStore.getState().status).toBe('anonymous')
      expect(useSessionStore.getState().user).toBeNull()
    } finally {
      setAuthProvider(null)
    }
  })
})
