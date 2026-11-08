import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app'
import { MemoryDataStore } from '../src/store/memory-store'
import type { DataStore } from '../src/store/types'

const DAY_MS = 24 * 60 * 60 * 1000

async function makeApp(store: DataStore = new MemoryDataStore()): Promise<FastifyInstance> {
  return buildApp({
    store,
    logger: false,
    config: {
      store: 'memory',
      sessionTtlMs: 7 * DAY_MS,
      // Generous limits here; dedicated rate-limit tests set their own.
      rateLimit: { loginMax: 100, registerMax: 100, windowMs: 60_000 },
    },
  })
}

function sessionCookie(response: { cookies: { name: string; value: string }[] }): string | undefined {
  return response.cookies.find((cookie) => cookie.name === 'agehaos_session')?.value
}

describe('auth API', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('reports health', async () => {
    app = await makeApp()
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it('registers a user, sets an HttpOnly session cookie and returns the public user', async () => {
    app = await makeApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', password: 'secret123' },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json() as { user: Record<string, string>; expiresAt: number }
    expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'id', 'updatedAt', 'username'])
    expect(body.user.username).toBe('alice')
    expect(body.expiresAt).toBeGreaterThan(Date.now())

    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).toContain('agehaos_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(sessionCookie(response)).toBeDefined()
  })

  it('rejects duplicate usernames with 409 user-exists', async () => {
    app = await makeApp()
    const payload = { username: 'bob', password: 'secret123' }
    await app.inject({ method: 'POST', url: '/api/auth/register', payload })
    const second = await app.inject({ method: 'POST', url: '/api/auth/register', payload })
    expect(second.statusCode).toBe(409)
    expect(second.json()).toEqual({ error: 'user-exists' })
  })

  it('logs in with valid credentials and rotates the session token', async () => {
    app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'carol', password: 'secret123' },
    })
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'carol', password: 'secret123' },
    })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'carol', password: 'secret123' },
    })
    expect(second.statusCode).toBe(200)
    expect(sessionCookie(second)).not.toBe(sessionCookie(first))
    expect(second.json()).toMatchObject({ user: { username: 'carol' } })
  })

  it('rejects wrong passwords and unknown users with 401 invalid-credentials', async () => {
    app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'dave', password: 'secret123' },
    })
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'dave', password: 'wrongpw' },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json()).toEqual({ error: 'invalid-credentials' })

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: 'secret123' },
    })
    expect(unknown.statusCode).toBe(401)
    expect(unknown.json()).toEqual({ error: 'invalid-credentials' })
  })

  it('resolves the session and current user from the cookie', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'erin', password: 'secret123' },
    })
    const token = sessionCookie(registered)
    expect(token).toBeDefined()

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: { agehaos_session: token ?? '' },
    })
    expect(session.statusCode).toBe(200)
    expect(session.json()).toMatchObject({ user: { username: 'erin' }, expiresAt: expect.any(Number) })

    const me = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      cookies: { agehaos_session: token ?? '' },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ user: { username: 'erin' } })

    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/session' })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json()).toEqual({ error: 'not-authenticated' })
  })

  it('logs out, invalidates the server-side session and clears the cookie', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'frank', password: 'secret123' },
    })
    const token = sessionCookie(registered) ?? ''
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { agehaos_session: token },
    })
    expect(logout.statusCode).toBe(204)
    const setCookie = logout.headers['set-cookie'] as string
    expect(setCookie).toContain('Max-Age=0')

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: { agehaos_session: token },
    })
    expect(after.statusCode).toBe(401)
  })

  it('rejects expired sessions and prunes them on the next login', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store)
    await store.init()
    await store.createUser({
      id: 'u1',
      username: 'grace',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      passwordHash: await (await import('../src/password')).hashPassword('secret123'),
    })
    await store.createSession({ token: 'expired', userId: 'u1', expiresAt: Date.now() - 1000 })

    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: { agehaos_session: 'expired' },
    })
    expect(stale.statusCode).toBe(401)

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'grace', password: 'secret123' },
    })
    expect(await store.findSession('expired')).toBeNull()
  })

  it.each([
    ['short password', { username: 'alice', password: '123' }],
    ['bad username characters', { username: 'has space', password: 'secret123' }],
    ['username too long', { username: 'a'.repeat(33), password: 'secret123' }],
    ['missing fields', { username: 'alice' }],
    ['wrong types', { username: 42, password: 'secret123' }],
  ])('validates register input: %s', async (_label, payload) => {
    app = await makeApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: payload as Record<string, unknown>,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid-body' })
  })

  it('normalizes malformed JSON bodies to invalid-body', async () => {
    app = await makeApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: '{oops',
      headers: { 'content-type': 'application/json' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid-body' })
  })

  it('updates profile fields via PATCH /users/me and reflects them in session', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'profileuser', password: 'secret123' },
    })
    const cookies = { agehaos_session: sessionCookie(registered) ?? '' }

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies,
      payload: { displayName: '爱丽丝', email: 'alice@example.com' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      user: { username: 'profileuser', displayName: '爱丽丝', email: 'alice@example.com' },
    })

    const me = await app.inject({ method: 'GET', url: '/api/users/me', cookies })
    expect(me.json()).toMatchObject({ user: { displayName: '爱丽丝' } })

    // Explicit null clears; absent leaves untouched.
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies,
      payload: { email: null },
    })
    expect(cleared.json().user.email).toBeUndefined()
    expect(cleared.json().user.displayName).toBe('爱丽丝')
  })

  it('updates the avatar via PATCH /users/me with a format whitelist', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'avataruser', password: 'secret123' },
    })
    const cookies = { agehaos_session: sessionCookie(registered) ?? '' }
    const avatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

    const set = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies,
      payload: { avatar },
    })
    expect(set.statusCode).toBe(200)
    expect(set.json().user.avatar).toBe(avatar)

    const me = await app.inject({ method: 'GET', url: '/api/users/me', cookies })
    expect(me.json().user.avatar).toBe(avatar)

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies,
      payload: { avatar: null },
    })
    expect(cleared.json().user.avatar).toBeUndefined()

    // 格式白名单：svg（可携带脚本）与 http URL 一律拒绝。
    for (const evil of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://evil.example/a.png']) {
      const rejected = await app.inject({
        method: 'PATCH',
        url: '/api/users/me',
        cookies,
        payload: { avatar: evil },
      })
      expect(rejected.statusCode).toBe(400)
      expect(rejected.json()).toEqual({ error: 'invalid-body' })
    }
  })

  it('rejects profile updates without a session or with a malformed email', async () => {
    app = await makeApp()
    const anonymous = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { displayName: 'x' },
    })
    expect(anonymous.statusCode).toBe(401)

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'profileuser2', password: 'secret123' },
    })
    const badEmail = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies: { agehaos_session: sessionCookie(registered) ?? '' },
      payload: { email: 'not-an-email' },
    })
    expect(badEmail.statusCode).toBe(400)
    expect(badEmail.json()).toEqual({ error: 'invalid-body' })
  })

  it('changes password, keeps the current session and revokes other sessions', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'pwuser', password: 'secret123' },
    })
    const currentToken = sessionCookie(registered) ?? ''
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'pwuser', password: 'secret123' },
    })
    const otherToken = sessionCookie(other) ?? ''

    const wrongCurrent = await app.inject({
      method: 'POST',
      url: '/api/users/me/password',
      cookies: { agehaos_session: currentToken },
      payload: { currentPassword: 'wrong!!', newPassword: 'newpass123' },
    })
    expect(wrongCurrent.statusCode).toBe(401)
    expect(wrongCurrent.json()).toEqual({ error: 'invalid-credentials' })

    const changed = await app.inject({
      method: 'POST',
      url: '/api/users/me/password',
      cookies: { agehaos_session: currentToken },
      payload: { currentPassword: 'secret123', newPassword: 'newpass123' },
    })
    expect(changed.statusCode).toBe(204)

    // Current session survives; the pre-change one is revoked; old password dead.
    expect(
      (await app.inject({ method: 'GET', url: '/api/users/me', cookies: { agehaos_session: currentToken } }))
        .statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ method: 'GET', url: '/api/users/me', cookies: { agehaos_session: otherToken } }))
        .statusCode,
    ).toBe(401)
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'pwuser', password: 'secret123' },
    })
    expect(oldLogin.statusCode).toBe(401)
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'pwuser', password: 'newpass123' },
    })
    expect(newLogin.statusCode).toBe(200)
  })

  it('revokes other sessions on demand while keeping the current one', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'revokeuser', password: 'secret123' },
    })
    const currentToken = sessionCookie(registered) ?? ''
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'revokeuser', password: 'secret123' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'revokeuser', password: 'secret123' },
    })

    const revoked = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-others',
      cookies: { agehaos_session: currentToken },
    })
    expect(revoked.statusCode).toBe(200)
    expect(revoked.json()).toEqual({ revoked: 2 })
    expect(
      (await app.inject({ method: 'GET', url: '/api/users/me', cookies: { agehaos_session: currentToken } }))
        .statusCode,
    ).toBe(200)

    const anonymous = await app.inject({ method: 'POST', url: '/api/auth/sessions/revoke-others' })
    expect(anonymous.statusCode).toBe(401)
  })

  it('lists own sessions with hashed ids and revokes one by id', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'devicemgmt', password: 'secret123' },
    })
    const currentCookie = { agehaos_session: sessionCookie(registered) ?? '' }
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'devicemgmt', password: 'secret123' },
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Firefox/128.0' },
    })
    const otherToken = sessionCookie(other) ?? ''

    const list = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      cookies: currentCookie,
    })
    expect(list.statusCode).toBe(200)
    const rows = list.json().sessions as Array<{
      id: string
      device: string
      current: boolean
      createdAt: string | null
    }>
    expect(rows).toHaveLength(2)
    const currentRow = rows.find((row) => row.current)
    const otherRow = rows.find((row) => !row.current)
    // inject 不带 UA → 引擎回落到通用标签；关键的 Other 行由 UA 解析而来。
    expect(currentRow?.device.length ?? 0).toBeGreaterThan(0)
    expect(otherRow?.device).toBe('Firefox · Windows')
    expect(currentRow?.createdAt).not.toBeNull()
    // 令牌本体绝不出现在列表里。
    expect(JSON.stringify(rows)).not.toContain(otherToken)

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${otherRow?.id}`,
      cookies: currentCookie,
    })
    expect(revoked.json()).toEqual({ revoked: true })
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          cookies: { agehaos_session: otherToken },
        })
      ).statusCode,
    ).toBe(401)

    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/auth/sessions/does-not-exist',
      cookies: currentCookie,
    })
    expect(missing.statusCode).toBe(404)

    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/sessions' })
    expect(anonymous.statusCode).toBe(401)
  })

  it('stores and returns per-user sync data', async () => {
    app = await makeApp()
    const anonymous = await app.inject({ method: 'GET', url: '/api/sync/data' })
    expect(anonymous.statusCode).toBe(401)

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'syncuser', password: 'secret123' },
    })
    const cookies = { agehaos_session: sessionCookie(registered) ?? '' }

    const empty = await app.inject({ method: 'GET', url: '/api/sync/data', cookies })
    expect(empty.json()).toEqual({ data: null })

    const put = await app.inject({
      method: 'PUT',
      url: '/api/sync/data',
      cookies,
      payload: { data: '{"settings":{"theme":"dark"}}' },
    })
    expect(put.json()).toEqual({ ok: true })

    const roundtrip = await app.inject({ method: 'GET', url: '/api/sync/data', cookies })
    expect(roundtrip.json()).toEqual({ data: '{"settings":{"theme":"dark"}}' })

    const oversized = await app.inject({
      method: 'PUT',
      url: '/api/sync/data',
      cookies,
      payload: { data: 'x'.repeat(256 * 1024 + 1) },
    })
    expect(oversized.statusCode).toBe(400)
    expect(oversized.json()).toEqual({ error: 'invalid-body' })
  })

  it('stores sync domains under separate keys with the settings alias (云文件切片)', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'syncdomain', password: 'secret123' },
    })
    const cookies = { agehaos_session: sessionCookie(registered) ?? '' }

    const putFiles = await app.inject({
      method: 'PUT',
      url: '/api/sync/data/files',
      cookies,
      payload: { data: '{"version":1,"savedAt":10,"tree":{"dirs":[],"files":[]}}' },
    })
    expect(putFiles.json()).toEqual({ ok: true })

    // 无键别名读写 settings 域，与 files 互不可见。
    const putSettings = await app.inject({
      method: 'PUT',
      url: '/api/sync/data',
      cookies,
      payload: { data: '{"settings":{"theme":"dark"}}' },
    })
    expect(putSettings.json()).toEqual({ ok: true })

    const files = await app.inject({ method: 'GET', url: '/api/sync/data/files', cookies })
    expect(files.json()).toEqual({ data: '{"version":1,"savedAt":10,"tree":{"dirs":[],"files":[]}}' })
    const settings = await app.inject({ method: 'GET', url: '/api/sync/data/settings', cookies })
    expect(settings.json()).toEqual({ data: '{"settings":{"theme":"dark"}}' })
    const alias = await app.inject({ method: 'GET', url: '/api/sync/data', cookies })
    expect(alias.json()).toEqual({ data: '{"settings":{"theme":"dark"}}' })
    const untouched = await app.inject({ method: 'GET', url: '/api/sync/data/other', cookies })
    expect(untouched.json()).toEqual({ data: null })

    // 域名格式守门 + 匿名访问守门。
    const badDomain = await app.inject({ method: 'GET', url: '/api/sync/data/Bad_Domain', cookies })
    expect(badDomain.statusCode).toBe(400)
    expect(badDomain.json()).toEqual({ error: 'invalid-sync-domain' })
    const anonymousFiles = await app.inject({ method: 'PUT', url: '/api/sync/data/files', payload: { data: 'x' } })
    expect(anonymousFiles.statusCode).toBe(401)
  })

  it('caps the number of sync domains per user (A1 审查)', async () => {
    app = await makeApp()
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'synccap', password: 'secret123' },
    })
    const cookies = { agehaos_session: sessionCookie(registered) ?? '' }

    for (let i = 0; i < 8; i += 1) {
      const put = await app.inject({
        method: 'PUT',
        url: `/api/sync/data/domain-${i}`,
        cookies,
        payload: { data: `blob-${i}` },
      })
      expect(put.statusCode).toBe(200)
    }
    const overflow = await app.inject({
      method: 'PUT',
      url: '/api/sync/data/domain-8',
      cookies,
      payload: { data: 'overflow' },
    })
    expect(overflow.statusCode).toBe(400)
    expect(overflow.json()).toEqual({ error: 'too-many-sync-domains' })

    // 已存在域仍可覆盖写（上限只拦新域）。
    const overwrite = await app.inject({
      method: 'PUT',
      url: '/api/sync/data/domain-0',
      cookies,
      payload: { data: 'updated' },
    })
    expect(overwrite.statusCode).toBe(200)
    const read = await app.inject({ method: 'GET', url: '/api/sync/data/domain-0', cookies })
    expect(read.json()).toEqual({ data: 'updated' })
  })

  it('answers unknown routes with JSON 404', async () => {
    app = await makeApp()
    const response = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not-found' })
  })
})
