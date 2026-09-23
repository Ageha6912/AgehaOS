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

  it('answers unknown routes with JSON 404', async () => {
    app = await makeApp()
    const response = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not-found' })
  })
})
