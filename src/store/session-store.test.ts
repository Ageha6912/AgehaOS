import { describe, it, expect, beforeEach } from 'vitest'

import { systemAuthService } from '@/core/auth'

import { resetSessionStore, useSessionStore } from './session-store'

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
})
