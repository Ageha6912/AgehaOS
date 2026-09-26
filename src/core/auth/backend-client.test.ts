import { describe, expect, it, vi } from 'vitest'

import { RemoteAuthClient } from './backend-client'
import { AuthError } from './types'
import type { User } from './types'

interface RecordedRequest {
  url: string
  init: RequestInit
}

interface FakeResponseInit {
  status: number
  body?: unknown
}

function makeFetch(responses: FakeResponseInit[] = [{ status: 200, body: {} }]) {
  const requests: RecordedRequest[] = []
  const queue = [...responses]
  const fetchFn = vi.fn(
    async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(url), init: init ?? {} })
      const next = queue.shift() ?? queue.at(-1)
      const { status, body } = next ?? { status: 500, body: {} }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as Response
    },
  )
  return { fetchFn, requests }
}

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => map,
  }
}

const USER: User = {
  id: 'u1',
  username: 'alice',
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
}

function makeClient(
  fetchSetup: Parameters<typeof makeFetch>[0],
  options: { now?: () => number } = {},
) {
  const storage = fakeStorage()
  const { fetchFn, requests } = makeFetch(fetchSetup)
  const bus = { emit: vi.fn() }
  const client = new RemoteAuthClient({
    fetchFn,
    storage,
    now: options.now ?? (() => 1_000_000),
    bus,
  })
  return { client, fetchFn, requests, storage, bus }
}

const SESSION_BODY = { user: USER, expiresAt: 2_000_000 }

describe('RemoteAuthClient', () => {
  it('registers and caches the non-sensitive session metadata', async () => {
    const { client, requests, storage } = makeClient([{ status: 201, body: SESSION_BODY }])

    const user = await client.register('alice', 'secret123')
    expect(user).toEqual(USER)
    expect(requests[0]?.url).toBe('/api/auth/register')
    expect(requests[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      username: 'alice',
      password: 'secret123',
    })
    expect(requests[0]?.init.credentials).toBe('same-origin')

    // Cached metadata only — no token ever lands in storage.
    expect(JSON.parse(storage.getItem('agehaos.auth.remote.v1') ?? '')).toEqual(SESSION_BODY)
    expect(storage.getItem('agehaos.auth.remote.v1')).not.toContain('token')
  })

  it('maps server error codes onto AuthError', async () => {
    const { client } = makeClient([{ status: 409, body: { error: 'user-exists' } }])
    const error = await client.register('alice', 'secret123').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe('user-exists')
  })

  it('surfaces rate limits and network failures as plain errors', async () => {
    const limited = makeClient([{ status: 429, body: { error: 'rate-limited' } }])
    await expect(limited.client.login('alice', 'secret123')).rejects.toThrow('auth-http-429')

    const offline = makeClient([])
    offline.fetchFn.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(offline.client.login('alice', 'secret123')).rejects.toThrow('auth-network-error')
  })

  it('logs in, returns a redacted session and keeps the cookie token server-side', async () => {
    const { client, requests } = makeClient([{ status: 200, body: SESSION_BODY }])

    const result = await client.login('alice', 'secret123')
    expect(result.user).toEqual(USER)
    expect(result.session).toEqual({ token: '', userId: 'u1', expiresAt: 2_000_000 })
    expect(requests[0]?.url).toBe('/api/auth/login')
    expect(client.getSession()).toEqual(result.session)
  })

  it('expires the cached session based on the injected clock', async () => {
    let now = 1_000_000
    const { client } = makeClient([{ status: 200, body: SESSION_BODY }], {
      now: () => now,
    })
    await client.login('alice', 'secret123')
    expect(client.getUser()).toEqual(USER)

    now = 2_000_001
    expect(client.getSession()).toBeNull()
    expect(client.getUser()).toBeNull()
  })

  it('logs out locally and best-effort on the server', async () => {
    const { client, requests } = makeClient([
      { status: 200, body: SESSION_BODY },
      { status: 204 },
    ])
    await client.login('alice', 'secret123')

    expect(client.logout()).toBe('u1')
    expect(client.getSession()).toBeNull()
    // Fire-and-forget logout: let the microtask queue drain.
    await Promise.resolve()
    await Promise.resolve()
    expect(requests[1]?.url).toBe('/api/auth/logout')
    expect(requests[1]?.init.method).toBe('POST')
  })

  it('broadcasts user.login on register/login and user.logout on logout', async () => {
    const { client, bus } = makeClient([
      { status: 201, body: SESSION_BODY },
      { status: 200, body: SESSION_BODY },
      { status: 204 },
    ])

    // 注册即登录：登录钩子（动态桌面/文件同步）依赖这条事件。
    await client.register('alice', 'secret123')
    expect(bus.emit).toHaveBeenCalledWith('user.login', { userId: 'u1' })

    await client.login('alice', 'secret123')
    expect(bus.emit).toHaveBeenCalledTimes(2)
    expect(bus.emit).toHaveBeenLastCalledWith('user.login', { userId: 'u1' })

    client.logout()
    expect(bus.emit).toHaveBeenLastCalledWith('user.logout', { userId: 'u1' })
  })

  it('emits user.logout even when the server round-trip fails', async () => {
    const { client, bus } = makeClient([
      { status: 200, body: SESSION_BODY },
      { status: 500, body: {} },
    ])
    await client.login('alice', 'secret123')
    // 登出是本地事实：网络失败也必须广播，否则监听方状态泄漏。
    expect(client.logout()).toBe('u1')
    expect(bus.emit).toHaveBeenCalledWith('user.logout', { userId: 'u1' })
  })

  it('reconciles against the server and clears state when signed out', async () => {
    const live = makeClient([{ status: 200, body: SESSION_BODY }])
    expect(await live.client.reconcile()).toEqual(USER)

    const dead = makeClient([{ status: 401, body: { error: 'not-authenticated' } }])
    dead.storage.setItem('agehaos.auth.remote.v1', JSON.stringify(SESSION_BODY))
    expect(await dead.client.reconcile()).toBeNull()
    expect(dead.client.getUser()).toBeNull()
    expect(dead.storage.getItem('agehaos.auth.remote.v1')).toBeNull()
  })

  it('patches the profile and keeps the cache in sync', async () => {
    const updated = { ...USER, displayName: 'Alice Liddell', email: 'alice@example.com' }
    const { client, requests } = makeClient([
      { status: 200, body: SESSION_BODY },
      { status: 200, body: { user: updated } },
    ])
    await client.login('alice', 'secret123')

    const user = await client.updateProfile({ displayName: 'Alice Liddell', email: 'alice@example.com' })
    expect(user).toEqual(updated)
    expect(requests[1]?.url).toBe('/api/users/me')
    expect(requests[1]?.init.method).toBe('PATCH')
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      displayName: 'Alice Liddell',
      email: 'alice@example.com',
    })
    expect(client.getUser()).toEqual(updated)
  })

  it('changes password and revokes other sessions through the API', async () => {
    const { client, requests } = makeClient([
      { status: 200, body: SESSION_BODY },
      { status: 204 },
      { status: 200, body: { revoked: 2 } },
    ])
    await client.login('alice', 'secret123')

    await expect(
      client.changePassword('secret123', 'newpass123'),
    ).resolves.toBeUndefined()
    expect(requests[1]?.url).toBe('/api/users/me/password')
    expect(requests[1]?.init.method).toBe('POST')
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      currentPassword: 'secret123',
      newPassword: 'newpass123',
    })

    await expect(client.revokeOtherSessions()).resolves.toBe(2)
    expect(requests[2]?.url).toBe('/api/auth/sessions/revoke-others')
  })

  it('maps a wrong current password onto AuthError', async () => {
    const { client } = makeClient([
      { status: 200, body: SESSION_BODY },
      { status: 401, body: { error: 'invalid-credentials' } },
    ])
    await client.login('alice', 'secret123')
    const error = await client
      .changePassword('wrongpw1', 'newpass123')
      .catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe('invalid-credentials')
  })

  it('survives reloads by restoring the cache from storage', async () => {
    const storage = fakeStorage()
    storage.setItem('agehaos.auth.remote.v1', JSON.stringify(SESSION_BODY))
    const { fetchFn } = makeFetch([])
    const client = new RemoteAuthClient({
      fetchFn,
      storage,
      now: () => 1_000_000,
    })
    expect(client.getUser()).toEqual(USER)
    // No server round-trip needed for the cached fast path.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('ignores malformed cached payloads', () => {
    const storage = fakeStorage()
    storage.setItem('agehaos.auth.remote.v1', '{nope')
    const { fetchFn } = makeFetch([])
    const client = new RemoteAuthClient({ fetchFn, storage, now: () => 1_000_000 })
    expect(client.getUser()).toBeNull()
  })
})
