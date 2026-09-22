import { describe, it, expect, vi } from 'vitest'

import { AuthService } from './auth-service'
import { generateSalt, hashPassword, verifyPassword } from './password'
import { AuthError } from './types'

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  }
}

function createService(options: { sessionTtlMs?: number; now?: () => number } = {}) {
  const storage = fakeStorage()
  const bus = { emit: vi.fn() }
  let counter = 0
  const service = new AuthService({
    storage,
    bus,
    generateId: () => `id-${++counter}`,
    ...options,
  })
  return { service, storage, emit: bus.emit }
}

describe('password', () => {
  it('verifies a hashed password and rejects wrong ones', async () => {
    const salt = generateSalt()
    const hash = await hashPassword('secret123', salt)

    expect(await verifyPassword('secret123', salt, hash)).toBe(true)
    expect(await verifyPassword('wrong', salt, hash)).toBe(false)
  })

  it('produces different hashes for different salts', async () => {
    const first = await hashPassword('secret123', generateSalt())
    const second = await hashPassword('secret123', generateSalt())

    expect(first).not.toBe(second)
  })
})

describe('AuthService.register', () => {
  it('creates a user without exposing password material', async () => {
    const { service } = createService()

    const user = await service.register('alice', 'secret123')

    expect(user.username).toBe('alice')
    expect(user.id).toBe('id-1')
    expect(user).not.toHaveProperty('passwordHash')
  })

  it('persists users (never plaintext passwords)', async () => {
    const { service, storage } = createService()

    await service.register('alice', 'secret123')

    const raw = storage.dump()['agehaos.users.v1']
    expect(raw).toContain('alice')
    expect(raw).not.toContain('secret123')
  })

  it('rejects duplicate usernames, bad names and weak passwords', async () => {
    const { service } = createService()

    await service.register('alice', 'secret123')

    await expect(service.register('alice', 'other123')).rejects.toMatchObject({
      code: 'user-exists',
    })
    await expect(service.register('ab', 'secret123')).rejects.toMatchObject({
      code: 'invalid-username',
    })
    await expect(service.register('bad name', 'secret123')).rejects.toMatchObject({
      code: 'invalid-username',
    })
    await expect(service.register('bob', '12345')).rejects.toMatchObject({
      code: 'weak-password',
    })
  })
})

describe('AuthService.login', () => {
  it('logs in with correct credentials and emits user.login', async () => {
    const { service, emit } = createService()
    await service.register('alice', 'secret123')

    const { user, session } = await service.login('alice', 'secret123')

    expect(user.username).toBe('alice')
    expect(session.userId).toBe(user.id)
    expect(session.token).toBe('id-2')
    expect(emit).toHaveBeenCalledWith('user.login', { userId: user.id })
  })

  it('rejects wrong passwords and unknown users with the same error', async () => {
    const { service } = createService()
    await service.register('alice', 'secret123')

    const wrongPassword = await service.login('alice', 'nope123').catch((error) => error)
    const unknownUser = await service.login('ghost', 'whatever').catch((error) => error)

    expect(wrongPassword).toBeInstanceOf(AuthError)
    expect(wrongPassword.code).toBe('invalid-credentials')
    expect(unknownUser.code).toBe('invalid-credentials')
  })

  it('stores the session with an expiry based on the TTL', async () => {
    const now = vi.fn().mockReturnValue(1_000_000)
    const { service, storage } = createService({ sessionTtlMs: 5_000, now })
    await service.register('alice', 'secret123')

    const { session } = await service.login('alice', 'secret123')

    expect(session.expiresAt).toBe(1_005_000)
    expect(storage.dump()['agehaos.session.v1']).toContain(session.token)
  })
})

describe('AuthService sessions', () => {
  it('returns the current session and user after login', async () => {
    const { service } = createService()
    const registered = await service.register('alice', 'secret123')
    await service.login('alice', 'secret123')

    expect(service.getSession()?.userId).toBe(registered.id)
    expect(service.getUser()?.username).toBe('alice')
  })

  it('logs out, clears the session and emits user.logout', async () => {
    const { service, emit } = createService()
    const registered = await service.register('alice', 'secret123')
    await service.login('alice', 'secret123')

    expect(service.logout()).toBe(registered.id)

    expect(service.getSession()).toBeNull()
    expect(service.getUser()).toBeNull()
    expect(emit).toHaveBeenCalledWith('user.logout', { userId: registered.id })
    expect(service.logout()).toBeNull()
  })

  it('treats expired sessions as signed out and clears them', async () => {
    let currentTime = 1_000_000
    const { service, storage } = createService({ sessionTtlMs: 5_000, now: () => currentTime })
    await service.register('alice', 'secret123')
    await service.login('alice', 'secret123')

    currentTime += 6_000
    expect(service.getSession()).toBeNull()
    expect(service.getUser()).toBeNull()
    expect(storage.dump()['agehaos.session.v1']).toBeUndefined()
  })

  it('keeps unexpired sessions across restarts', async () => {
    const { service, storage } = createService()
    await service.register('alice', 'secret123')
    await service.login('alice', 'secret123')
    const token = service.getSession()?.token

    const restarted = new AuthService({ storage })

    expect(restarted.getSession()?.token).toBe(token)
    expect(restarted.getUser()?.username).toBe('alice')
  })
})
