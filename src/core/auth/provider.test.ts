import { describe, expect, it, vi } from 'vitest'

import { AuthService, getAuthProvider, setAuthProvider, systemAuthService } from '@/core/auth'
import type { AuthProvider } from '@/core/auth'
import type { AuthResult, Session, User } from '@/core/auth'

const USER: User = {
  id: 'u1',
  username: 'remote-alice',
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
}

function stubProvider(loginResult: AuthResult): AuthProvider {
  return {
    register: vi.fn(async () => USER),
    login: vi.fn(async () => loginResult),
    logout: vi.fn(() => 'u1'),
    getSession: vi.fn(() => loginResult.session),
    getUser: vi.fn(() => USER),
    reconcile: vi.fn(async () => USER),
    updateProfile: vi.fn(async () => USER),
    changePassword: vi.fn(async () => {}),
    revokeOtherSessions: vi.fn(async () => 2),
    listSessions: vi.fn(async () => [
      { id: 's1', device: 'Chrome · Windows', createdAt: null, current: true },
    ]),
    revokeSession: vi.fn(async () => {}),
  }
}

describe('auth provider facade', () => {
  it('defaults to the local AuthService', () => {
    expect(getAuthProvider()).toBeInstanceOf(AuthService)
  })

  it('delegates every call to the installed provider', async () => {
    const session: Session = { token: 't', userId: 'u1', expiresAt: 1 }
    const stub = stubProvider({ user: USER, session })
    try {
      setAuthProvider(stub)

      await expect(systemAuthService.register('remote-alice', 'secret123')).resolves.toEqual(USER)
      await expect(systemAuthService.login('remote-alice', 'secret123')).resolves.toEqual({
        user: USER,
        session,
      })
      expect(systemAuthService.logout()).toBe('u1')
      expect(systemAuthService.getSession()).toEqual(session)
      expect(systemAuthService.getUser()).toEqual(USER)
      await expect(systemAuthService.reconcile()).resolves.toEqual(USER)
      await expect(systemAuthService.updateProfile({ displayName: 'Alice' })).resolves.toEqual(USER)
      await expect(systemAuthService.changePassword('a', 'b')).resolves.toBeUndefined()
      await expect(systemAuthService.revokeOtherSessions()).resolves.toBe(2)
      await expect(systemAuthService.listSessions()).resolves.toHaveLength(1)
      await expect(systemAuthService.revokeSession('s1')).resolves.toBeUndefined()
    } finally {
      setAuthProvider(null)
    }
    expect(vi.mocked(stub.login)).toHaveBeenCalledWith('remote-alice', 'secret123')
    expect(vi.mocked(stub.updateProfile)).toHaveBeenCalledWith({ displayName: 'Alice' })
    expect(vi.mocked(stub.changePassword)).toHaveBeenCalledWith('a', 'b')
  })

  it('restores the local provider on setAuthProvider(null)', () => {
    setAuthProvider(stubProvider({ user: USER, session: { token: '', userId: 'u1', expiresAt: 1 } }))
    setAuthProvider(null)
    expect(getAuthProvider()).toBeInstanceOf(AuthService)
  })
})
