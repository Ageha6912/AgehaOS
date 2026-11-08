import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app'
import { MemoryDataStore } from '../src/store/memory-store'
import type { ServerConfig } from '../src/config'

async function makeApp(config: Partial<ServerConfig> = {}): Promise<FastifyInstance> {
  return buildApp({
    store: new MemoryDataStore(),
    logger: false,
    config: { store: 'memory', rateLimit: { loginMax: 100, registerMax: 100, windowMs: 60_000 }, ...config },
  })
}

async function registerUser(app: FastifyInstance, username: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret123' },
  })
  return response.cookies.find((cookie) => cookie.name === 'agehaos_session')?.value ?? ''
}

describe('security posture', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('rejects mutating requests with a foreign Origin (CSRF guard)', async () => {
    app = await makeApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret123' },
      headers: { origin: 'http://evil.example' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('accepts same-host origins and configured allowlist origins', async () => {
    app = await makeApp({ allowedOrigins: ['https://desktop.agehaos.dev'] })
    const sameHost = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'secret123' },
      headers: { host: 'localhost:8787', origin: 'http://localhost:8787' },
    })
    expect(sameHost.statusCode).not.toBe(403)

    const allowlisted = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'bob', password: 'secret123' },
      headers: { origin: 'https://desktop.agehaos.dev' },
    })
    expect(allowlisted.statusCode).toBe(201)
  })

  it('does not apply the origin check to GET requests', async () => {
    app = await makeApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { origin: 'http://evil.example' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'not-authenticated' })
  })

  it('marks the cookie Secure in production mode', async () => {
    app = await makeApp({ cookieSecure: true })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'carol', password: 'secret123' },
    })
    expect(response.headers['set-cookie'] as string).toContain('Secure')
  })

  it('rate limits logins per route without blocking register', async () => {
    app = await makeApp({ rateLimit: { loginMax: 2, registerMax: 100, windowMs: 60_000 } })
    await registerUser(app, 'dave')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attempt1 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'dave', password: 'wrongpw' },
      })
      expect(attempt1.statusCode).toBe(401)
    }
    const third = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'dave', password: 'wrongpw' },
    })
    expect(third.statusCode).toBe(429)
    expect(third.json()).toEqual({ error: 'rate-limited' })

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'erin', password: 'secret123' },
    })
    expect(register.statusCode).toBe(201)
  })

  it('rate limits by the proxy-appended rightmost XFF, not a forged leftmost value (A1 审查)', async () => {
    app = await makeApp({ rateLimit: { loginMax: 2, registerMax: 100, windowMs: 60_000 } })
    await registerUser(app, 'grace')

    // 反代 `$proxy_add_x_forwarded_for` 追加语义：真实地址在最右，攻击者自带
    // 的 XFF 留在最左。trustProxy:true 会取最左（每请求换一个 → 永不限流）；
    // 收窄到 loopback 后取最右（203.0.113.7）→ 第三次必须 429。
    for (let i = 0; i < 2; i += 1) {
      const attempt = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` },
        payload: { username: 'grace', password: 'wrongpw' },
      })
      expect(attempt.statusCode).toBe(401)
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.9.9.9, 203.0.113.7' },
      payload: { username: 'grace', password: 'wrongpw' },
    })
    expect(blocked.statusCode).toBe(429)
  })

  it('sends hardened default headers (helmet)', async () => {
    app = await makeApp()
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.headers['content-security-policy']).toBeDefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('normalizes configured allowlist origins (尾斜杠/大小写不再 403，A1 审查)', async () => {
    app = await makeApp({ allowedOrigins: ['HTTPS://Desktop.AgehaOS.dev/', 'not a url'] })
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'norma', password: 'secret123' },
      headers: { origin: 'https://desktop.agehaos.dev' },
    })
    expect(register.statusCode).toBe(201)

    // 非法配置项跳过（fail-closed）：陌生 origin 仍 403。
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'norma', password: 'secret123' },
      headers: { origin: 'http://evil.example' },
    })
    expect(foreign.statusCode).toBe(403)
  })

  it('rate limits PATCH /users/me like the password route (A1 审查)', async () => {
    app = await makeApp({ rateLimit: { loginMax: 2, registerMax: 100, windowMs: 60_000 } })
    const cookie = await registerUser(app, 'patchy')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ok = await app.inject({
        method: 'PATCH',
        url: '/api/users/me',
        cookies: { agehaos_session: cookie },
        payload: { displayName: `n${attempt}` },
      })
      expect(ok.statusCode).toBe(200)
    }
    const blocked = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      cookies: { agehaos_session: cookie },
      payload: { displayName: 'blocked' },
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: 'rate-limited' })
  })

  it('never echoes hashes and never logs raw tokens', async () => {
    app = await makeApp()
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'frank', password: 'secret123' },
    })
    const body = register.json() as { user: Record<string, unknown> }
    expect(JSON.stringify(body)).not.toContain('passwordHash')
    expect(JSON.stringify(body)).not.toContain('scrypt$')
    const cookieValue = (register.headers['set-cookie'] as string).split(';')[0]
    expect(JSON.stringify(body)).not.toContain(cookieValue)
  })
})
