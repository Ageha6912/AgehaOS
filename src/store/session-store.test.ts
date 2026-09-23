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
