import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildApp } from '../src/app'
import { loadOrCreateSigningKey } from '../src/store-keys'
import { MemoryDataStore } from '../src/store/memory-store'
import type { DataStore } from '../src/store/types'

const DAY_MS = 24 * 60 * 60 * 1000

async function makeApp(
  store: DataStore = new MemoryDataStore(),
  adminUsername: string | null = null,
): Promise<FastifyInstance> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agehaos-admin-'))
  return buildApp({
    store,
    logger: false,
    signingKey: await loadOrCreateSigningKey(dir),
    config: {
      store: 'memory',
      sessionTtlMs: 7 * DAY_MS,
      rateLimit: { loginMax: 100, registerMax: 100, windowMs: 60_000 },
      adminUsername,
    },
  })
}

function sessionCookie(response: { cookies: { name: string; value: string }[] }): string | undefined {
  return response.cookies.find((cookie) => cookie.name === 'agehaos_session')?.value
}

async function register(app: FastifyInstance, username: string, password = 'secret123') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  })
  return { response, cookies: { agehaos_session: sessionCookie(response) ?? '' } }
}

/** 目录/复审类测试的 admin 造数：注册后经 store 直授角色（绕开授权路径本身）。 */
async function registerAsAdmin(
  app: FastifyInstance,
  store: DataStore,
  username: string,
  password = 'secret123',
) {
  const { response, cookies } = await register(app, username, password)
  const user = await store.findUserByUsername(username)
  if (!user) throw new Error('register did not persist the user')
  await store.updateUser({ ...user, role: 'admin' })
  return { response, cookies }
}

const VALID_APP = {
  id: 'com.ageha.samples.counter2',
  name: '计数器二号',
  version: '1.0.0',
  entry: '/apps/sites/counter/index.html',
  permissions: [],
  window: { width: 320, height: 280, resizable: true },
  author: 'AgehaOS Samples',
  description: '管理员发布验证用。',
}

describe('admin role & catalog publishing (ADR 20)', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('does NOT grant admin at register time, even for the bootstrap username（评审 P0-1 防抢注）', async () => {
    app = await makeApp(new MemoryDataStore(), 'boss')
    const { response, cookies } = await register(app, 'boss')
    expect(response.statusCode).toBe(201)
    expect(response.json().user.role).toBeUndefined()

    const me = await app.inject({ method: 'GET', url: '/api/users/me', cookies })
    expect(me.json().user.role).toBeUndefined()
  })

  it('keeps regular users at the default role', async () => {
    app = await makeApp(new MemoryDataStore(), 'boss')
    const { response } = await register(app, 'mallory')
    expect(response.json().user.role).toBeUndefined()
  })

  it('promotes an existing user retroactively on boot (幂等提升)', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store)
    const { cookies } = await register(app, 'root')
    await app.close()

    const rebooted = await makeApp(store, 'root')
    const me = await rebooted.inject({ method: 'GET', url: '/api/users/me', cookies })
    expect(me.json().user.role).toBe('admin')
    await rebooted.close()
  })

  it('lets only admins read/publish the catalog', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store, 'boss')
    const admin = await registerAsAdmin(app, store, 'boss')
    const user = await register(app, 'mallory')

    const anonymous = await app.inject({ method: 'PUT', url: '/api/store/admin/catalog', payload: { apps: [] } })
    expect(anonymous.statusCode).toBe(401)

    const asUser = await app.inject({
      method: 'PUT',
      url: '/api/store/admin/catalog',
      cookies: user.cookies,
      payload: { apps: [VALID_APP] },
    })
    expect(asUser.statusCode).toBe(403)
    expect(asUser.json()).toEqual({ error: 'not-admin' })

    const asAdmin = await app.inject({
      method: 'PUT',
      url: '/api/store/admin/catalog',
      cookies: admin.cookies,
      payload: { apps: [VALID_APP] },
    })
    expect(asAdmin.statusCode).toBe(200)
    expect(asAdmin.json().apps).toHaveLength(1)

    const listing = await app.inject({ method: 'GET', url: '/api/store/admin/catalog', cookies: admin.cookies })
    expect(listing.json().apps[0].id).toBe('com.ageha.samples.counter2')
  })

  it('serves the published catalog through the signed public endpoint', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store, 'boss')
    const admin = await registerAsAdmin(app, store, 'boss')
    await app.inject({
      method: 'PUT',
      url: '/api/store/admin/catalog',
      cookies: admin.cookies,
      payload: { apps: [VALID_APP] },
    })

    const publicCatalog = await app.inject({ method: 'GET', url: '/api/store/catalog' })
    const body = publicCatalog.json()
    expect(body.payload.apps).toHaveLength(1)
    expect(body.payload.apps[0].id).toBe('com.ageha.samples.counter2')
    expect(body.signature).toBeTruthy()
  })

  it('rejects invalid catalog entries at the whitelist gate', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store, 'boss')
    const admin = await registerAsAdmin(app, store, 'boss')

    const cases: unknown[] = [
      // entry 越出同源 allowlist。
      [{ ...VALID_APP, entry: 'https://evil.example/app.html' }],
      // entry 上跳。
      [{ ...VALID_APP, entry: '/apps/sites/../evil/index.html' }],
      // 未知权限名。
      [{ ...VALID_APP, permissions: ['root-access'] }],
      // 白名单之外的多余字段。
      [{ ...VALID_APP, extra: 'field' }],
      // 窗口尺寸越界。
      [{ ...VALID_APP, window: { width: 50, height: 280, resizable: true } }],
      // 非 object 条目（schema 层拦截 → invalid-body）。
      ['not-an-object'],
    ]
    for (const apps of cases) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/store/admin/catalog',
        cookies: admin.cookies,
        payload: { apps },
      })
      expect(response.statusCode).toBe(400)
      expect(['invalid-catalog', 'invalid-body']).toContain(response.json().error)
    }

    // 全部被拒后公共目录保持内置（未被污染）。
    const publicCatalog = await app.inject({ method: 'GET', url: '/api/store/catalog' })
    expect(publicCatalog.json().payload.apps.some((a: { id: string }) => a.id === 'com.ageha.samples.counter2')).toBe(false)
  })
})
