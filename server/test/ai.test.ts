import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app'
import { aiRoutes, parseItems } from '../src/routes/ai'
import { MemoryDataStore } from '../src/store/memory-store'

const VALID_BODY = {
  anonymId: 'anon-1234567890',
  locale: 'zh-CN' as const,
  context: { timePhase: 'day', season: 'autumn' },
  prefs: ['warm'],
  slots: ['tip'],
}

function openAiShape(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] })
}

/** Fake OpenAI-compatible upstream; records requests for assertions. */
function startUpstream(handler: (reqBody: Record<string, unknown>, auth: string | undefined) => void | Promise<void>, respond?: (reqBody: Record<string, unknown>) => string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      request.on('end', () => {
        const reqBody = JSON.parse(raw) as Record<string, unknown>
        void Promise.resolve(handler(reqBody, request.headers.authorization)).then(() => {
          response.setHeader('content-type', 'application/json')
          response.end(openAiShape(respond ? respond(reqBody) : '{}'))
        })
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function baseUrlOf(server: Server): string {
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/v1`
}

async function makeApp(ai: Partial<{ apiKey: string | null; baseUrl: string; model: string; timeoutMs: number }>): Promise<FastifyInstance> {
  return buildApp({
    store: new MemoryDataStore(),
    logger: false,
    config: {
      store: 'memory',
      rateLimit: { loginMax: 100, registerMax: 100, windowMs: 60_000 },
      ai: { apiKey: 'test-key', baseUrl: 'http://unused.invalid/v1', model: 'test-model', timeoutMs: 2000, ...ai },
    },
  })
}

describe('ai proxy route (DDS §5.3)', () => {
  let app: FastifyInstance
  let upstream: Server | null = null

  afterEach(async () => {
    await app?.close()
    if (upstream) {
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream?.close(() => resolve()))
      upstream = null
    }
  })

  it('is disabled without an API key: 503 ai-not-configured', async () => {
    app = await makeApp({ apiKey: null })
    const response = await app.inject({ method: 'POST', url: '/api/ai/proxy', payload: VALID_BODY })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'ai-not-configured' })
  })

  it('validates the request contract', async () => {
    app = await makeApp({ apiKey: 'k' })
    const missing = await app.inject({
      method: 'POST',
      url: '/api/ai/proxy',
      payload: { ...VALID_BODY, slots: undefined },
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json()).toEqual({ error: 'invalid-body' })

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/ai/proxy',
      payload: { ...VALID_BODY, context: { blob: 'x'.repeat(3000) } },
    })
    expect(oversized.statusCode).toBe(400)
  })

  it('forwards aggregated features only (no anonymId) and schema-filters the answer', async () => {
    let seenAuth: string | undefined
    let seenBody: Record<string, unknown> = {}
    upstream = await startUpstream(
      (reqBody, auth) => {
        seenBody = reqBody
        seenAuth = auth
      },
      () =>
        JSON.stringify({
          items: [
            { slotId: 'tip', text: 'pin', extraField: 'must-not-leak' },
            { slotId: 'unknown-slot', text: 'drop me' },
            { slotId: 'tip', text: 'duplicate, dropped' },
            { slotId: 'tip', text: 'x'.repeat(201) },
          ],
        }),
    )
    app = await makeApp({ apiKey: 'secret-key', baseUrl: baseUrlOf(upstream) })

    const response = await app.inject({ method: 'POST', url: '/api/ai/proxy', payload: VALID_BODY })
    expect(response.statusCode).toBe(200)

    // Key stays server-side; anonymId never travels upstream.
    expect(seenAuth).toBe('Bearer secret-key')
    const userContent = JSON.parse((seenBody.messages as Array<{ content: string }>)[1]?.content ?? '{}')
    expect(userContent).toEqual({ locale: 'zh-CN', context: VALID_BODY.context, prefs: ['warm'], slots: ['tip'] })
    expect(JSON.stringify(seenBody)).not.toContain('anon-1234567890')
    expect(seenBody.model).toBe('test-model')

    // Unknown fields/slots and oversized values are dropped before leaving the server.
    expect(response.json()).toEqual({ items: [{ slotId: 'tip', text: 'pin' }] })
  })

  it('maps upstream failures to dedicated error codes', async () => {
    // Unparseable model output → ai-invalid-response.
    upstream = await startUpstream(
      () => {},
      () => '抱歉，我无法完成该请求。',
    )
    app = await makeApp({ apiKey: 'k', baseUrl: baseUrlOf(upstream) })
    const bad = await app.inject({
      method: 'POST',
      url: '/api/ai/proxy',
      payload: VALID_BODY,
    })
    expect(bad.statusCode).toBe(502)
    expect(bad.json()).toEqual({ error: 'ai-invalid-response' })
    await app.close()

    // Upstream unreachable → ai-upstream. (A freshly-closed ephemeral port
    // deterministically refuses connections, unlike well-known ports that
    // Windows firewall may silently drop.)
    const dead = createServer(() => {})
    const deadPort = await new Promise<number>((resolve) => {
      dead.listen(0, '127.0.0.1', () => resolve((dead.address() as AddressInfo).port))
    })
    await new Promise<void>((resolve) => dead.close(() => resolve()))
    app = await makeApp({ apiKey: 'k', baseUrl: `http://127.0.0.1:${deadPort}/v1`, timeoutMs: 2000 })
    const unreachable = await app.inject({ method: 'POST', url: '/api/ai/proxy', payload: VALID_BODY })
    expect(unreachable.statusCode).toBe(502)
    expect(unreachable.json()).toEqual({ error: 'ai-upstream' })
    await app.close()

    // Slow upstream → abort → ai-timeout.
    const hanging = createServer(() => {
      /* never respond */
    })
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', () => resolve()))
    upstream = hanging
    app = await makeApp({ apiKey: 'k', baseUrl: baseUrlOf(hanging), timeoutMs: 150 })
    const slow = await app.inject({ method: 'POST', url: '/api/ai/proxy', payload: VALID_BODY })
    expect(slow.statusCode).toBe(504)
    expect(slow.json()).toEqual({ error: 'ai-timeout' })
  })

  it('rejects foreign origins like every other mutating route', async () => {
    app = await makeApp({ apiKey: null })
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/proxy',
      payload: VALID_BODY,
      headers: { origin: 'http://evil.example' },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('parseItems', () => {
  it('strips markdown fences and accepts valid JSON', () => {
    const items = parseItems('```json\n{"items":[{"slotId":"tip","text":"pin"}]}\n```', ['tip'])
    expect(items).toEqual([{ slotId: 'tip', text: 'pin' }])
  })

  it('returns null for non-JSON content', () => {
    expect(parseItems('抱歉，我无法完成该请求。', ['tip'])).toBeNull()
    expect(parseItems('{"nope":1}', ['tip'])).toBeNull()
  })
})

describe('ai proxy 上游失败分支（A1 审查轻微项）', () => {
  it('非 2xx 时消费/取消上游响应体，keepAlive 连接不被挂死', async () => {
    const upstream = new Response('gateway exploded', { status: 502 })
    const fetcher = vi.fn(async () => upstream)
    const app = Fastify({ logger: false })
    await app.register(aiRoutes, {
      ai: { apiKey: 'k', baseUrl: 'http://unused.invalid/v1', model: 'm', timeoutMs: 1000 },
      rateLimitWindowMs: 60_000,
      fetcher: fetcher as unknown as typeof fetch,
    })
    const response = await app.inject({
      method: 'POST',
      url: '/ai/proxy',
      payload: VALID_BODY,
    })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'ai-upstream' })
    // cancel() 会锁定流：bodyUsed 变 true = 旧实现的悬置 body 已被消费。
    expect(upstream.bodyUsed).toBe(true)
    await app.close()
  })
})
