import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app'
import { MemoryDataStore } from '../src/store/memory-store'
import { MAX_CONTENT_SAMPLES } from '../src/store/types'
import type { DataStore } from '../src/store/types'

const DAY_MS = 24 * 60 * 60 * 1000

async function makeApp(
  store: DataStore = new MemoryDataStore(),
  adminUsername: string | null = null,
): Promise<FastifyInstance> {
  return buildApp({
    store,
    logger: false,
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

describe('content sample upload（DDS §8.6 匿名上报 + 服务端分类器）', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('accepts a benign sample anonymously and stores it for review', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store)
    const response = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '今天适合把窗口排成两列，效率更高。' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ status: 'accepted', classification: 'ok' })
    expect(response.json().id).toEqual(expect.any(String))

    const stored = await store.listContentSamples()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.text).toBe('今天适合把窗口排成两列，效率更高。')
    expect(stored[0]?.classification).toBe('ok')
  })

  it('rejects violating text with 422 and never persists it', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store)
    const response = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '今晚赌场见' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ error: 'content-rejected' })
    expect(await store.listContentSamples()).toEqual([])
  })

  it('stores misleading and discomfort classifications for human review', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store)
    const misleading = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '加我微信 abc123456 领取壁纸包' },
    })
    expect(misleading.json()).toMatchObject({ classification: 'misleading' })
    const discomfort = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '哈哈哈哈哈哈哈哈哈哈哈哈' },
    })
    expect(discomfort.json()).toMatchObject({ classification: 'discomfort' })
    expect(await store.listContentSamples()).toHaveLength(2)
  })

  it('validates the body shape', async () => {
    app = await makeApp()
    const url = '/api/dynamic/samples'
    expect(
      (await app.inject({ method: 'POST', url, payload: {} })).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'POST', url, payload: { text: '' } })).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'POST', url, payload: { text: '   ' } })).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'POST', url, payload: { text: '好'.repeat(513) } })).statusCode,
    ).toBe(400)
    // 注：Fastify 默认 Ajv 会把数字/布尔强转为字符串，故非法形状用 null 与非对象体。
    expect(
      (await app.inject({ method: 'POST', url, payload: { text: null } })).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'POST', url, payload: [1, 2] })).statusCode,
    ).toBe(400)
  })

  it('caps storage at MAX_CONTENT_SAMPLES keeping the newest', async () => {
    const store = new MemoryDataStore()
    // 直接压 store：路由侧另有 10 次/分钟的匿名限流，走 HTTP 无法凑满容量。
    for (let i = 0; i < MAX_CONTENT_SAMPLES + 5; i++) {
      await store.createContentSample({
        id: `s${i}`,
        text: `样本 ${i}`,
        classification: 'ok',
        createdAt: new Date(Date.UTC(2026, 8, 28, 0, 0, 0, i)).toISOString(),
      })
    }
    const stored = await store.listContentSamples()
    expect(stored).toHaveLength(MAX_CONTENT_SAMPLES)
    expect(stored[0]?.text).toBe(`样本 ${MAX_CONTENT_SAMPLES + 4}`)
  })

  it('rate-limits anonymous uploads per IP', async () => {
    app = await makeApp()
    let lastCode = 0
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/dynamic/samples',
        payload: { text: `限流样本 ${i}` },
      })
      lastCode = response.statusCode
    }
    expect(lastCode).toBe(429)
  })

  it('serves the review listing to admins only, newest first', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store, 'boss')
    const first = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '较早的样本' },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '较晚的样本' },
    })
    const firstId = (first.json() as { id: string }).id
    const secondId = (second.json() as { id: string }).id

    expect(
      (await app.inject({ method: 'GET', url: '/api/dynamic/samples' })).statusCode,
    ).toBe(401)

    const plain = await register(app, 'alice')
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/dynamic/samples',
      cookies: plain.cookies,
    })
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json()).toEqual({ error: 'not-admin' })

    const admin = await register(app, 'boss')
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/dynamic/samples',
      cookies: admin.cookies,
    })
    expect(allowed.statusCode).toBe(200)
    expect((allowed.json() as { samples: { id: string }[] }).samples.map((s) => s.id)).toEqual([
      secondId,
      firstId,
    ])
  })

  it('deletes a reviewed sample as admin and 404s on unknown ids', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store, 'boss')
    const created = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '待处置样本' },
    })
    const id = (created.json() as { id: string }).id
    const admin = await register(app, 'boss')

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/dynamic/samples/${id}`,
      cookies: admin.cookies,
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ deleted: true })
    expect((await store.listContentSamples()).map((s) => s.id)).toEqual([])

    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/dynamic/samples/no-such-id`,
      cookies: admin.cookies,
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'not-found' })
  })

  it('rejects sample deletion from anonymous and non-admin callers', async () => {
    const store = new MemoryDataStore()
    app = await makeApp(store, 'boss')
    const created = await app.inject({
      method: 'POST',
      url: '/api/dynamic/samples',
      payload: { text: '不应被别人删掉的样本' },
    })
    const id = (created.json() as { id: string }).id

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/dynamic/samples/${id}` })).statusCode,
    ).toBe(401)

    const plain = await register(app, 'alice')
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/dynamic/samples/${id}`,
      cookies: plain.cookies,
    })
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json()).toEqual({ error: 'not-admin' })
    // 样本仍在：守卫生效。
    expect((await store.listContentSamples()).map((s) => s.id)).toEqual([id])
  })
})
