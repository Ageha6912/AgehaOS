import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { getAppManifest, resetAppStore } from '@/store/app-store'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { useWindowStore } from '@/store/window-store'

import { createEclosionCache, type EclosionCache } from './eclosion-cache'
import {
  EclosionOrchestrator,
  ECLOSION_MAX_CONCURRENT_STREAMS,
  systemEclosion,
} from './eclosion'

/**
 * 编排器单测：fetcher/cache 注入（服务端交互全部走假传输），IndexedDB 用
 * fake-indexeddb；事件经 systemBus 断言（afterEach clear 防跨用例污染）。
 */

const CALCULATOR = 'com.ageha.eclosion.calculator'
const NOTES = 'com.ageha.eclosion.notes'
const CLOCK = 'com.ageha.eclosion.clock'

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function sseResponse(frames: string[]): Response {
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** 分多块下发的 SSE（验证跨 chunk 半帧解析 + 边流边切分）。 */
function streamingResponse(pieces: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const piece of pieces) controller.enqueue(encoder.encode(piece))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
}

const quotaOk = (): Response =>
  new Response(
    JSON.stringify({
      configured: true,
      quotas: { basic: { used: 1, limit: 10 }, today: { used: 0, limit: 30 }, imagine: { used: 0, limit: 20 } },
      resetAtIso: '2026-10-03T00:00:00.000Z',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

const DOC_HTML =
  '<!doctype html><html><head><style>body{color:red}</style></head><body><div class="app">1</div><script>console.log(1)</script><p>tail</p></body></html>'

/** 假传输：URL 路由 + 每次调用压栈（可逐响应脚本化；GET 无 body 记 {}）。 */
function makeTransport(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith('/quota')) return quotaOk()
    calls.push({
      url: String(url),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    })
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (next === undefined) return new Response('{}', { status: 500 })
    return next
  })
  return { fetcher, calls }
}

function makeOrchestrator(fetcher: ReturnType<typeof makeTransport>['fetcher'], cache?: EclosionCache) {
  return new EclosionOrchestrator({ fetcher, cache: cache ?? createEclosionCache() })
}

// fake-indexeddb 同文件共享库：每个用例独立 userId，免数据库清理竞态。
let userSeq = 0
let user = ''

beforeEach(() => {
  userSeq += 1
  user = `u-orch-${userSeq}`
  localStorage.clear()
  resetEclosionStore()
  resetAppStore()
  seedEclosionForTests(user, true)
  systemBus.clear()
})

afterEach(() => {
  systemBus.clear()
})

describe('EclosionOrchestrator：缓存命中秒开（§4.2/§5.2）', () => {
  it('serves a cached document without touching the network, splitting it instantly', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(user, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 3,
      html: DOC_HTML,
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher, cache)
    const decision = vi.fn()
    systemBus.on('ai.decision.performed', decision) // 订阅先于建会话：命中即同步发

    const session = orchestrator.ensureSession(CALCULATOR)
    expect(session).not.toBeNull()
    await session!.settled()

    const snapshot = session!.getSnapshot()
    expect(snapshot.phase).toBe('done')
    expect(snapshot.source).toBe('cache')
    // 分片 = 标记（绝不含 script）；脚本截留在宿主侧。
    const chunkHtml = snapshot.chunks.map((chunk) => chunk.html).join('')
    expect(chunkHtml).toContain('<style>body{color:red}</style>')
    expect(chunkHtml).toContain('<div class="app">1</div>')
    expect(chunkHtml).not.toContain('console.log')
    expect(snapshot.scripts).toEqual(['console.log(1)'])
    // 秒开 = 零网络；ai.decision.performed source=cache。
    expect(calls).toHaveLength(0)
    expect(decision).toHaveBeenCalledWith({ domain: 'app', source: 'cache' })
  })

  it('keeps the §10 password warning when reopening from the L1 cache (zero-network path)', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(user, {
      appId: NOTES,
      specId: 'notes',
      specVersion: 3,
      html: '<!doctype html><html><body><input type="password" id="p"></body></html>',
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher, cache)

    const session = orchestrator.ensureSession(NOTES)!
    await session.settled()

    // 缓存秒开路径（重启后重开的主路径）：警示必须来自本地扫描，而非
    // 只在首次网络生成时出现。
    const snapshot = session.getSnapshot()
    expect(snapshot.phase).toBe('done')
    expect(snapshot.source).toBe('cache')
    expect(snapshot.passwordInputSeen).toBe(true)
    expect(useEclosionStore.getState().statuses[NOTES]?.passwordInputSeen).toBe(true)
    // 零网络：证明走的是缓存而非再次生成。
    expect(calls).toHaveLength(0)
  })

  it('reports ready with the session provenance once rendered', async () => {
    const { fetcher } = makeTransport([sseResponse([frame('meta', { requestId: 'r', model: 'm' }), frame('done', { bytes: 1, ms: 2 })])])
    const orchestrator = makeOrchestrator(fetcher)
    const session = orchestrator.ensureSession(CALCULATOR)!
    await session.settled()

    const ready = vi.fn()
    systemBus.on('eclosion.app.ready', ready)
    orchestrator.reportRendered(CALCULATOR)
    expect(ready).toHaveBeenCalledWith({
      appId: CALCULATOR,
      specId: 'calculator',
      source: 'network',
    })
  })
})

describe('EclosionOrchestrator：SSE 流式生成（§5.3）', () => {
  it('streams chunks split by html-stream, counts thinking chars, caches the document', async () => {
    const { fetcher, calls } = makeTransport([
      streamingResponse([
        frame('meta', { requestId: 'r1', model: 'test-model' }),
        frame('think', { chars: 40 }),
        frame('delta', { text: '<!doctype html><html><head><style>a{b}</style>' }),
        frame('think', { chars: 120 }),
        frame('delta', { text: '</head><body><div>x</div>' }),
        frame('delta', { text: '<script>evil()</script><p>y</p></body></html>' }),
        frame('done', { bytes: 99, ms: 1500 }),
      ]),
    ])
    const cache = createEclosionCache()
    const orchestrator = makeOrchestrator(fetcher, cache)
    const generating = vi.fn()
    systemBus.on('eclosion.app.generating', generating)

    const session = orchestrator.ensureSession(CALCULATOR)!
    await session.settled()

    const snapshot = session.getSnapshot()
    expect(snapshot.phase).toBe('done')
    expect(snapshot.source).toBe('network')
    expect(snapshot.thinkChars).toBe(120)
    const joined = snapshot.chunks.map((chunk) => chunk.html).join('')
    expect(joined).toContain('<style>a{b}</style>')
    expect(joined).toContain('<div>x</div>')
    expect(joined).not.toContain('evil()')
    expect(snapshot.scripts).toEqual(['evil()'])
    expect(generating).toHaveBeenCalledWith({ appId: CALCULATOR, specId: 'calculator' })

    // 请求体：kind/specId/locale/theme，不带 hint（ADR 27）。
    expect(calls[0]?.body).toMatchObject({ kind: 'basic', specId: 'calculator', theme: 'light' })
    expect(String((calls[0]?.body as Record<string, unknown>).locale)).toMatch(/^(zh-CN|en)$/)
    expect('hint' in (calls[0]?.body ?? {})).toBe(false)

    // 落缓存：重开秒开。
    const cached = await cache.readBasic(user, 'calculator', 3)
    expect(cached?.html).toContain('evil()') // 缓存存全文（下次由分片器截留）
    const replay = makeOrchestrator(makeTransport([]).fetcher, cache)
    const second = replay.ensureSession(CALCULATOR)!
    await second.settled()
    expect(second.getSnapshot().source).toBe('cache')
  })

  it('marks a password input in the generated content (§10 host-side scan)', async () => {
    const { fetcher } = makeTransport([
      sseResponse([
        frame('delta', { text: '<!doctype html><html><body><input type="password" id="p">' }),
        frame('done', { bytes: 1, ms: 1 }),
      ]),
    ])
    const orchestrator = makeOrchestrator(fetcher)
    const session = orchestrator.ensureSession(NOTES)!
    await session.settled()
    expect(session.getSnapshot().passwordInputSeen).toBe(true)
    expect(useEclosionStore.getState().statuses[NOTES]?.passwordInputSeen).toBe(true)
  })

  it('fails with the SSE error code (invalid-output)', async () => {
    const { fetcher } = makeTransport([
      sseResponse([frame('meta', {}), frame('delta', { text: '<!doctype html>' }), frame('error', { code: 'invalid-output' })]),
    ])
    const orchestrator = makeOrchestrator(fetcher)
    const session = orchestrator.ensureSession(CALCULATOR)!
    await session.settled()
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', errorCode: 'invalid-output' })
  })

  it('maps non-2xx JSON errors (503 ai-not-configured) without retrying', async () => {
    const { fetcher, calls } = makeTransport([
      new Response(JSON.stringify({ error: 'ai-not-configured' }), { status: 503 }),
    ])
    const orchestrator = makeOrchestrator(fetcher)
    const session = orchestrator.ensureSession(CALCULATOR)!
    await session.settled()

    expect(orchestrator.requestRetry(CALCULATOR, 'run-error')).toBe(false)
    expect(session.getSnapshot().fellBack).toBe(true)
    expect(calls).toHaveLength(1) // 确定性 503：不烧第二次请求
  })

  it('treats a truncated stream as a network failure', async () => {
    const { fetcher } = makeTransport([sseResponse([frame('delta', { text: '<!doctype html>' })])])
    const orchestrator = makeOrchestrator(fetcher)
    const session = orchestrator.ensureSession(CALCULATOR)!
    await session.settled()
    expect(session.getSnapshot().errorCode).toBe('network')
  })
})

describe('EclosionOrchestrator：质量回退与重新羽化（§5.2/§5.4）', () => {
  it('retries once on retryable failures, then falls back and emits eclosion.app.failed', async () => {
    const { fetcher, calls } = makeTransport([
      sseResponse([frame('meta', {}), frame('error', { code: 'ai-upstream' })]),
      sseResponse([frame('meta', {}), frame('error', { code: 'ai-timeout' })]),
    ])
    const orchestrator = makeOrchestrator(fetcher)
    const failed = vi.fn()
    const decision = vi.fn()
    systemBus.on('eclosion.app.failed', failed)
    systemBus.on('ai.decision.performed', decision)

    const session = orchestrator.ensureSession(CLOCK)!
    await session.settled()
    expect(session.getSnapshot().attempt).toBe(1)

    // 第一次失败 → 自动重试（regenerate:true 绕开服务端全局缓存）。
    expect(orchestrator.requestRetry(CLOCK, 'run-error')).toBe(true)
    await session.settled()
    expect(session.getSnapshot().attempt).toBe(2)
    expect(calls[1]?.body).toMatchObject({ regenerate: true })

    // 第二次失败 → 终态回落 + 事件（通知桥只消费这一态）。
    expect(orchestrator.requestRetry(CLOCK, 'run-timeout')).toBe(false)
    expect(session.getSnapshot().fellBack).toBe(true)
    expect(failed).toHaveBeenCalledWith({ appId: CLOCK, specId: 'clock', reason: 'run-timeout' })
    expect(decision).toHaveBeenCalledWith({ domain: 'app', source: 'local' })
    // 再试不再产生请求。
    expect(orchestrator.requestRetry(CLOCK, 'again')).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('regenerate drops the local cache and asks the server to bypass the shared one', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(user, {
      appId: NOTES,
      specId: 'notes',
      specVersion: 3,
      html: '<!doctype html><html><body>old</body></html>',
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([
      sseResponse([frame('delta', { text: '<!doctype html><html><body>new</body></html>' }), frame('done', { bytes: 1, ms: 1 })]),
    ])
    const orchestrator = makeOrchestrator(fetcher, cache)

    const session = orchestrator.ensureSession(NOTES)!
    await session.settled()
    expect(session.getSnapshot().source).toBe('cache')

    orchestrator.regenerate(NOTES)
    await session.settled()
    const snapshot = session.getSnapshot()
    expect(snapshot.attempt).toBe(2)
    expect(snapshot.source).toBe('network')
    expect(calls[0]?.body).toMatchObject({ regenerate: true })
    // 新版本覆盖本地缓存。
    expect((await cache.readBasic(user, 'notes', 3))?.html).toContain('new')
  })

  it('reuses an in-flight session instead of duplicating generation (§5.4)', async () => {
    let releaseStream!: (value: string) => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(frame('meta', {})))
        releaseStream = (text: string) => {
          controller.enqueue(encoder.encode(text))
          controller.close()
        }
      },
    })
    const { fetcher, calls } = makeTransport([new Response(stream, { headers: { 'content-type': 'text/event-stream' } })])
    const orchestrator = makeOrchestrator(fetcher)

    const first = orchestrator.ensureSession(CALCULATOR)!
    const second = orchestrator.ensureSession(CALCULATOR)!
    expect(second).toBe(first)
    // fetch 在缓存读之后异步发生；会话复用不产生第二个请求。
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    releaseStream(frame('done', { bytes: 1, ms: 1 }))
    await first.settled()
    expect(first.getSnapshot().phase).toBe('done')
    expect(calls).toHaveLength(1)
  })
})

describe('EclosionOrchestrator：并发上限与取消（§5.4/§5.3）', () => {
  it('queues the third stream and starts it when a slot frees', async () => {
    const gates: Array<() => void> = []
    const makeGatedResponse = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode(frame('meta', {})))
            gates.push(() => {
              controller.enqueue(encoder.encode(frame('done', { bytes: 1, ms: 1 })))
              controller.close()
            })
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    const { fetcher, calls } = makeTransport([makeGatedResponse(), makeGatedResponse(), makeGatedResponse()])
    const orchestrator = makeOrchestrator(fetcher)
    expect(ECLOSION_MAX_CONCURRENT_STREAMS).toBe(2)

    const a = orchestrator.ensureSession(CALCULATOR)!
    const b = orchestrator.ensureSession(NOTES)!
    const c = orchestrator.ensureSession(CLOCK)!
    // 前两个占满并发槽。
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(a.getSnapshot().phase).toBe('generating')
    expect(b.getSnapshot().phase).toBe('generating')
    // 第三个排队并提示。
    expect(c.getSnapshot().phase).toBe('queued')
    expect(useEclosionStore.getState().statuses[CLOCK]?.phase).toBe('queued')

    gates[0]!() // 释放一个槽
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(c.getSnapshot().phase).toBe('generating')

    gates[1]!()
    gates[2]!()
    await a.settled()
    await b.settled()
    await c.settled()
    expect(c.getSnapshot().phase).toBe('done')
  })

  it('cancels an in-flight generation through AbortController', async () => {
    let observedSignal: AbortSignal | undefined
    const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (String(url).endsWith('/quota')) return quotaOk()
      observedSignal = init?.signal ?? undefined
      return new Promise<Response>((_, reject) => {
        observedSignal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
    const orchestrator = makeOrchestrator(fetcher)
    const session = orchestrator.ensureSession(CALCULATOR)!
    await vi.waitFor(() => expect(observedSignal).toBeDefined())

    orchestrator.cancel(CALCULATOR)
    await session.settled()
    const snapshot = session.getSnapshot()
    expect(snapshot).toMatchObject({ phase: 'error', errorCode: 'aborted' })
    // 主动取消不是失败：不重试、不发 eclosion.app.failed。
    const failed = vi.fn()
    systemBus.on('eclosion.app.failed', failed)
    expect(orchestrator.requestRetry(CALCULATOR, 'run-error')).toBe(false)
    expect(snapshot.fellBack).toBe(false)
    expect(failed).not.toHaveBeenCalled()
  })
})

describe('EclosionOrchestrator：预取与额度（§5.2/§9）', () => {
  it('prefetches missing specs sequentially and skips cached ones', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(user, {
      appId: NOTES,
      specId: 'notes',
      specVersion: 3,
      html: '<!doctype html><html><body>cached</body></html>',
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([
      sseResponse([frame('delta', { text: '<!doctype html><html><body>calc</body></html>' }), frame('done', {})]),
      sseResponse([frame('delta', { text: '<!doctype html><html><body>clock</body></html>' }), frame('done', {})]),
    ])
    const orchestrator = makeOrchestrator(fetcher, cache)

    await orchestrator.prefetchMissing()

    expect(calls.map((call) => (call.body as { specId: string }).specId)).toEqual(['calculator', 'clock'])
    expect(await cache.readBasic(user, 'calculator', 3)).not.toBeNull()
    expect(await cache.readBasic(user, 'clock', 3)).not.toBeNull()
  })

  it('does not prefetch when the mode is off or the user is missing', async () => {
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher)
    seedEclosionForTests(user, false)
    await orchestrator.prefetchMissing()
    resetEclosionStore()
    seedEclosionForTests('u-9', true)
    useEclosionStore.setState({ userId: null })
    await orchestrator.prefetchMissing()
    expect(calls).toHaveLength(0)
  })

  it('stores the three-tier quota snapshot for Settings', async () => {
    const { fetcher } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher)
    await orchestrator.refreshQuota()
    expect(useEclosionStore.getState().quota).toEqual({
      configured: true,
      basic: { used: 1, limit: 10 },
      today: { used: 0, limit: 30 },
      imagine: { used: 0, limit: 20 },
      resetAtIso: '2026-10-03T00:00:00.000Z',
    })

    // 非 JSON/失败 → configured:false（开关置灰依据）。
    const broken = new EclosionOrchestrator({
      fetcher: vi.fn(async () => {
        throw new Error('offline')
      }),
      cache: createEclosionCache(),
    })
    await broken.refreshQuota()
    expect(useEclosionStore.getState().quota?.configured).toBe(false)
  })
})

describe('systemEclosion 单例与 clearData', () => {
  it('clears the current user’s eclosion data', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(user, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 3,
      html: '<!doctype html>',
      createdAt: '',
    })
    systemEclosion.configureForTests({ cache })
    await systemEclosion.clearData()
    expect(await cache.readBasic(user, 'calculator', 3)).toBeNull()
  })

  it('wires login/logout through start(): hydrate + quota, then session cleanup', async () => {
    const { fetcher } = makeTransport([])
    const orchestrator = new EclosionOrchestrator({ fetcher, cache: createEclosionCache() })
    orchestrator.start()
    try {
      systemBus.emit('user.login', { userId: user })
      // hydrate + refreshQuota 都是异步：等额度快照落地。
      await vi.waitFor(() => expect(useEclosionStore.getState().quota).not.toBeNull())
      expect(useEclosionStore.getState().userId).toBe(user)
      expect(useEclosionStore.getState().quota?.configured).toBe(true)

      useEclosionStore.getState().setStatus(CALCULATOR, { phase: 'generating' })
      systemBus.emit('user.logout', { userId: user })
      expect(useEclosionStore.getState().userId).toBeNull()
      expect(useEclosionStore.getState().statuses).toEqual({})
    } finally {
      orchestrator.stop()
    }
  })
})

// ── 今日世界（§6.2/§6.3）：拉取、当日缓存、蝶谱、就绪事件 ─────────────────────

/** 有效世界载荷（与服务端 publicWorldPayload 同形；正反例口径见 core/eclosion/world.test.ts）。 */
function worldPayload(worldDate: string, headline = '本地智能体与边缘推理的清晨') {
  return {
    worldDate,
    generatedAt: `${worldDate}T00:05:00.000Z`,
    degraded: false,
    signalCount: 2,
    signals: {
      titles: ['信号甲', '信号乙'],
      sourceName: 'GitHub Trending',
      sourceUrl: 'https://example.invalid/feed',
    },
    theme: {
      headline,
      paletteId: 'nebula-violet',
      accentHue: 212,
      wallpaper: { engine: 'landscape', paletteId: 'nebula-violet', mood: 'calm' },
    },
    apps: Array.from({ length: 6 }, (_, index) => ({
      slug: `app-0${index + 1}`,
      name: `应用零${index}`,
      icon: 'Sparkle',
      hue: 268,
      tagline: '一句话描述',
      category: 'tools',
      window: { width: 720, height: 480 },
    })),
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('EclosionOrchestrator：今日世界（§6.2/§6.3）', () => {
  it('fetches the world on demand, stores the summary, writes the replay and emits ready', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const cache = createEclosionCache()
    const { fetcher, calls } = makeTransport([jsonResponse(worldPayload(today))])
    const orchestrator = makeOrchestrator(fetcher, cache)
    const ready = vi.fn()
    const decision = vi.fn()
    systemBus.on('eclosion.world.ready', ready)
    systemBus.on('ai.decision.performed', decision)

    await expect(orchestrator.refreshWorld()).resolves.toBe(true)

    expect(calls.map((call) => call.url)).toEqual(['/api/eclosion/world'])
    const world = useEclosionStore.getState().world
    expect(world?.worldDate).toBe(today)
    expect(world?.headline).toBe('本地智能体与边缘推理的清晨')
    expect(world?.apps).toHaveLength(6)
    // 事件载荷维持预留键的形状（{worldDate}，ADR 4 不扩）。
    expect(ready).toHaveBeenCalledWith({ worldDate: today })
    expect(decision).toHaveBeenCalledWith({ domain: 'world', source: 'llm' })
    // 蝶谱：每日一条、不含 HTML/hint。
    const replay = await cache.readReplay(user, today)
    expect(replay?.headline).toBe(world?.headline)
    expect(JSON.stringify(replay)).not.toContain('hint')
  })

  it('serves the day from the in-session cache without refetching (当日缓存)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { fetcher, calls } = makeTransport([jsonResponse(worldPayload(today))])
    const orchestrator = makeOrchestrator(fetcher)

    await orchestrator.refreshWorld()
    const fetched = calls.length
    const ready = vi.fn()
    systemBus.on('eclosion.world.ready', ready)

    // 第二次（同日）：不发请求，但重播就绪事件（开关重开/重登录接线重跑）。
    await expect(orchestrator.refreshWorld()).resolves.toBe(true)
    expect(calls.length).toBe(fetched)
    expect(ready).toHaveBeenCalledWith({ worldDate: today })
  })

  it('stays silent on failure paths (羽化关/未登录/坏载荷/非当日)——不阻塞桌面', async () => {
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher)

    seedEclosionForTests(user, false)
    await expect(orchestrator.refreshWorld()).resolves.toBe(false)
    seedEclosionForTests(user, true)
    useEclosionStore.setState({ userId: null })
    await expect(orchestrator.refreshWorld()).resolves.toBe(false)
    expect(calls).toHaveLength(0)

    seedEclosionForTests(user, true)
    const broken = makeOrchestrator(vi.fn(async () => jsonResponse({ error: 'world-unavailable' }, 503)))
    await expect(broken.refreshWorld()).resolves.toBe(false)
    expect(useEclosionStore.getState().world).toBeNull()

    // 载荷非法（apps 越界）：校验层整载荷拒绝，静默放弃。
    const today = new Date().toISOString().slice(0, 10)
    const garbage = makeOrchestrator(vi.fn(async () => jsonResponse({ ...worldPayload(today), apps: [] })))
    await expect(garbage.refreshWorld()).resolves.toBe(false)
    expect(useEclosionStore.getState().world).toBeNull()
  })

  it('rejects payloads whose worldDate is not today (跨日即换新)', async () => {
    const stale = '2000-01-01'
    const { fetcher } = makeTransport([jsonResponse(worldPayload(stale))])
    const orchestrator = makeOrchestrator(fetcher)
    const ready = vi.fn()
    systemBus.on('eclosion.world.ready', ready)

    await expect(orchestrator.refreshWorld()).resolves.toBe(false)
    expect(useEclosionStore.getState().world).toBeNull()
    expect(ready).not.toHaveBeenCalled()
  })

  it('regenerates a personal world variant via POST and refreshes the quota', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { fetcher, calls } = makeTransport([jsonResponse(worldPayload(today, '个人版世界'))])
    const orchestrator = makeOrchestrator(fetcher)
    const ready = vi.fn()
    systemBus.on('eclosion.world.ready', ready)

    await expect(orchestrator.regenerateWorld()).resolves.toBe(true)

    expect(calls[0]?.url).toBe('/api/eclosion/world/regenerate')
    expect(useEclosionStore.getState().world?.headline).toBe('个人版世界')
    expect(ready).toHaveBeenCalledWith({ worldDate: today })
    await vi.waitFor(() =>
      expect(useEclosionStore.getState().quota?.today).toEqual({ used: 0, limit: 30 }),
    )
  })

  it('wires refreshWorld into the login flow (start 装配)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    // 登录会按持久化偏好 hydrate：先把「羽化开」落盘，模拟真实偏好用户。
    seedEclosionForTests(user, true)
    useEclosionStore.getState().setEnabled(true)
    const { fetcher, calls } = makeTransport([jsonResponse(worldPayload(today))])
    const orchestrator = new EclosionOrchestrator({ fetcher, cache: createEclosionCache() })
    orchestrator.start()
    try {
      systemBus.emit('user.login', { userId: user })
      await vi.waitFor(() => expect(useEclosionStore.getState().world?.worldDate).toBe(today))
      expect(calls.some((call) => call.url === '/api/eclosion/world')).toBe(true)
    } finally {
      orchestrator.stop()
    }
  })
})

// ── 今日应用与留存（§6.4/§8）：kind=today 管线 / 当日缓存 / 预取 / kept ────

const TODAY_APP = (slug: string): string => `com.ageha.eclosion.${slug}`

function seedTodayWorld(date = new Date().toISOString().slice(0, 10)): void {
  useEclosionStore.getState().applyWorld({
    worldDate: date,
    headline: '本地智能体与边缘推理的清晨',
    paletteId: 'nebula-violet',
    accentHue: 212,
    degraded: false,
    signalCount: 2,
    signals: { titles: ['信号甲', '信号乙'], sourceName: 'GitHub Trending', sourceUrl: '' },
    apps: Array.from({ length: 6 }, (_, index) => ({
      slug: `app-0${index + 1}`,
      name: `应用零${index}`,
      hue: 200 + index * 10,
      tagline: '一句话',
      category: 'tools',
      window: { width: 720, height: 480 },
    })),
  })
}

const sseDoc = (html: string): Response =>
  new Response(frame('delta', { text: html }) + frame('done', {}), {
    headers: { 'content-type': 'text/event-stream' },
  })


/** 微任务内存缓存（fake timers 下不依赖 setImmediate 的时序）。 */
function memoryCacheShape(store: Map<string, string>): EclosionCache {
  return {
    async readBasic() {
      return null
    },
    async writeBasic(_userId, entry) {
      store.set(`basic:${entry.specId}:v${entry.specVersion}`, entry.html)
    },
    async readToday(userId, worldDate, slug) {
      const html = store.get(`today:${userId}:${worldDate}:${slug}`)
      return html === undefined
        ? null
        : { appId: `com.ageha.eclosion.${slug}`, worldDate, slug, html, createdAt: '' }
    },
    async writeToday(userId, entry) {
      store.set(`today:${userId}:${entry.worldDate}:${entry.slug}`, entry.html)
    },
    async readKept() {
      return null
    },
    async listKept() {
      return []
    },
    async writeKept() {},
    async deleteKept() {},
    async readReplay() {
      return null
    },
    async listReplay() {
      return []
    },
    async writeReplay() {},
    async pruneTodayBefore() {},
    async clearUserData() {},
  }
}

describe('EclosionOrchestrator：今日应用与留存（§6.4/§8）', () => {
  it('generates a today app on demand (kind=today) and caches it for the day', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    const { fetcher, calls } = makeTransport([sseDoc(DOC_HTML)])
    const orchestrator = makeOrchestrator(fetcher, cache)

    const session = orchestrator.ensureSession(TODAY_APP('app-01'))
    await session?.settled()

    expect(calls[0]?.body).toMatchObject({
      kind: 'today',
      worldDate: today,
      slug: 'app-01',
      regenerate: false,
    })
    expect(session?.getSnapshot()).toMatchObject({ phase: 'done', source: 'network' })
    // 当日缓存落库（次日换新 / 重开秒开的载体）。
    expect(await cache.readToday(user, today, 'app-01')).not.toBeNull()
  })

  it('serves the same-day reopen from the today cache without touching the network', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('app-01'),
      worldDate: today,
      slug: 'app-01',
      html: DOC_HTML,
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher, cache)

    const session = orchestrator.ensureSession(TODAY_APP('app-01'))
    await session?.settled()

    expect(calls).toHaveLength(0)
    expect(session?.getSnapshot()).toMatchObject({ phase: 'done', source: 'cache' })
  })

  it('regenerate skips the day cache and asks the server to bypass the global one', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('app-01'),
      worldDate: today,
      slug: 'app-01',
      html: '<!doctype html><html><body>旧版本</body></html>',
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([sseDoc(DOC_HTML)])
    const orchestrator = makeOrchestrator(fetcher, cache)

    const first = orchestrator.ensureSession(TODAY_APP('app-01'))
    await first?.settled() // 缓存命中
    const session = orchestrator.regenerate(TODAY_APP('app-01'))
    await session?.settled()

    expect(session?.getSnapshot().attempt).toBe(2)
    expect(calls[0]?.body).toMatchObject({ kind: 'today', regenerate: true })
    // 个人重生成覆盖当日缓存。
    expect((await cache.readToday(user, today, 'app-01'))?.html).toBe(DOC_HTML)
  })

  it('fails terminally without any native fallback path (L2 没有原生真身)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const { fetcher, calls } = makeTransport([
      new Response(JSON.stringify({ error: 'ai-not-configured' }), { status: 503 }),
    ])
    const orchestrator = makeOrchestrator(fetcher)
    const failed = vi.fn()
    systemBus.on('eclosion.app.failed', failed)

    const session = orchestrator.ensureSession(TODAY_APP('app-02'))
    await session?.settled()
    const retried = orchestrator.requestRetry(TODAY_APP('app-02'), 'test')

    expect(retried).toBe(false) // 未配置 AI 不重试，直接终态
    expect(session?.getSnapshot()).toMatchObject({ phase: 'error', fellBack: true })
    expect(calls).toHaveLength(1)
    expect(failed).toHaveBeenCalledWith({
      appId: TODAY_APP('app-02'),
      specId: 'app-02',
      reason: 'ai-not-configured',
    })
  })

  it('prefetches at most the first two world apps in the idle window (§6.4)', async () => {
    seedTodayWorld()
    const { fetcher, calls } = makeTransport([sseDoc(DOC_HTML), sseDoc(DOC_HTML), sseDoc(DOC_HTML)])
    // 坑 10：fake-indexeddb 走 setImmediate（不被 toFake 控制），fake timers
    // 推进期间不会落盘——预取断言只看网络调用，换微任务内存缓存隔离时序。
    const store = new Map<string, string>()
    const cache: EclosionCache = {
      ...memoryCacheShape(store),
    }
    const orchestrator = makeOrchestrator(fetcher, cache)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      orchestrator.scheduleTodayPrefetch()
      await vi.advanceTimersByTimeAsync(2_500)

      expect(calls.map((call) => (call.body as { slug?: string }).slug)).toEqual([
        'app-01',
        'app-02',
      ])
      // 每 worldDate 只安排一次。
      orchestrator.scheduleTodayPrefetch()
      await vi.advanceTimersByTimeAsync(2_500)
      expect(calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kept snapshots are cache-only: served from the kept store, unknown ids fail', async () => {
    const cache = createEclosionCache()
    await cache.writeKept(user, {
      appId: TODAY_APP('gone-kept'),
      name: '留存应用',
      html: DOC_HTML,
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher, cache)

    const kept = orchestrator.ensureSession(TODAY_APP('gone-kept'))
    await kept?.settled()
    expect(kept?.getSnapshot()).toMatchObject({ phase: 'done', source: 'cache' })
    expect(calls).toHaveLength(0)

    const unknown = orchestrator.ensureSession(TODAY_APP('ghost'))
    await unknown?.settled()
    expect(unknown?.getSnapshot()).toMatchObject({ phase: 'error', errorCode: 'unknown-app' })
  })

  it('keepApp snapshots the day cache into kept (LRU ≤30) and registers the manifest; unkeep reverses', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('app-01'),
      worldDate: today,
      slug: 'app-01',
      html: DOC_HTML,
      createdAt: '',
    })
    const orchestrator = makeOrchestrator(vi.fn(async () => new Response('{}')), cache)

    // 源缓存不在（未生成）→ 拒绝获取，绝不触发新的生成。
    await expect(orchestrator.keepApp(TODAY_APP('app-05'))).resolves.toBe(false)

    await expect(orchestrator.keepApp(TODAY_APP('app-01'))).resolves.toBe(true)
    const kept = await cache.readKept(user, TODAY_APP('app-01'))
    expect(kept).toMatchObject({ appId: TODAY_APP('app-01'), name: '应用零0', hue: 200 })
    expect(useEclosionStore.getState().keptAppIds).toContain(TODAY_APP('app-01'))
    expect(getAppManifest(TODAY_APP('app-01'))?.name).toBe('应用零0')

    await expect(orchestrator.unkeepApp(TODAY_APP('app-01'))).resolves.toBe(true)
    expect(await cache.readKept(user, TODAY_APP('app-01'))).toBeNull()
    expect(useEclosionStore.getState().keptAppIds).not.toContain(TODAY_APP('app-01'))
  })

  it('login prunes yesterday’s today cache and restores kept registrations (次日清理/跨重启)', async () => {
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('old-app'),
      worldDate: '2000-01-01',
      slug: 'old-app',
      html: DOC_HTML,
      createdAt: '',
    })
    await cache.writeKept(user, {
      appId: TODAY_APP('kept-one'),
      name: '留存一',
      html: DOC_HTML,
      createdAt: '',
    })
    const { fetcher } = makeTransport([])
    const orchestrator = new EclosionOrchestrator({ fetcher, cache })
    orchestrator.start()
    try {
      systemBus.emit('user.login', { userId: user })
      await vi.waitFor(() =>
        expect(useEclosionStore.getState().keptAppIds).toContain(TODAY_APP('kept-one')),
      )
      // 次日清理：昨日 today 缓存删除；kept/replay 不受影响（replay 由世界侧写）。
      expect(await cache.readToday(user, '2000-01-01', 'old-app')).toBeNull()
      expect(getAppManifest(TODAY_APP('kept-one'))?.name).toBe('留存一')

      // 登出：运行时清单整体注销（世界侧同理由 handleLogout 覆盖）。
      systemBus.emit('user.logout', { userId: user })
      expect(getAppManifest(TODAY_APP('kept-one'))).toBeNull()
      expect(useEclosionStore.getState().keptAppIds).toEqual([])
    } finally {
      orchestrator.stop()
    }
  })
})

// ── 想象搜索（§7，P3）：kind=imagine 管线 / 会话缓存 / 获取留存 ─────────────

import { imagineAppIdForQuery } from '@/core/eclosion/spec'

const IMAGINE_QUERY = '番茄钟 + 白噪音'
const IMAGINE_APP = imagineAppIdForQuery(IMAGINE_QUERY)

describe('EclosionOrchestrator：想象搜索（§7）', () => {
  it('gates the entry: disabled / not signed in / violation / too short → null, zero requests', async () => {
    const { fetcher, calls } = makeTransport([])
    const orchestrator = makeOrchestrator(fetcher)

    seedEclosionForTests(user, false)
    expect(orchestrator.ensureImagineSession(IMAGINE_QUERY)).toBeNull()
    seedEclosionForTests(user, true)
    useEclosionStore.setState({ userId: null })
    expect(orchestrator.ensureImagineSession(IMAGINE_QUERY)).toBeNull()
    seedEclosionForTests(user, true)
    // 客户端 filterContentText：违规词直接不生成（服务端 classifier 是第二道）。
    expect(orchestrator.ensureImagineSession('赌博工具')).toBeNull()
    expect(orchestrator.ensureImagineSession('a')).toBeNull() // <2 字
    expect(calls).toHaveLength(0)
  })

  it('generates kind=imagine with the raw query and registers a zero-permission manifest', async () => {
    const { fetcher, calls } = makeTransport([sseDoc(DOC_HTML)])
    const cache = createEclosionCache()
    const orchestrator = makeOrchestrator(fetcher, cache)

    const appId = orchestrator.ensureImagineSession(IMAGINE_QUERY)
    expect(appId).toBe(IMAGINE_APP)
    const session = orchestrator.ensureSession(IMAGINE_APP)
    await session?.settled()

    expect(calls[0]?.body).toMatchObject({
      kind: 'imagine',
      query: IMAGINE_QUERY,
      regenerate: false,
    })
    expect(session?.getSnapshot()).toMatchObject({ phase: 'done', source: 'network' })
    const manifest = getAppManifest(IMAGINE_APP)
    expect(manifest?.name).toBe(IMAGINE_QUERY)
    expect(manifest?.permissions).toEqual([]) // L3 恒零权限
    expect(manifest?.window).toEqual({ width: 720, height: 480, resizable: true })
    // §8：想象应用 HTML 只存内存——不落任何 IndexedDB store。
    expect(await cache.readBasic(user, 'calculator', 3)).toBeNull()
    expect(await cache.readToday(user, new Date().toISOString().slice(0, 10), 'x')).toBeNull()
    expect(await cache.readKept(user, IMAGINE_APP)).toBeNull()
  })

  it('reuses the in-session cache: same (or normalized-equal) query never refetches', async () => {
    const { fetcher, calls } = makeTransport([sseDoc(DOC_HTML)])
    const orchestrator = makeOrchestrator(fetcher)

    expect(orchestrator.ensureImagineSession(IMAGINE_QUERY)).toBe(IMAGINE_APP)
    const first = orchestrator.ensureSession(IMAGINE_APP)!
    await first.settled()
    // 同 query 二次入口（空白差异 → 规范化同键；大小写同理由 spec 表钉死）：零新请求。
    expect(orchestrator.ensureImagineSession(IMAGINE_QUERY)).toBe(IMAGINE_APP)
    expect(orchestrator.ensureImagineSession(`  ${IMAGINE_QUERY}  `)).toBe(IMAGINE_APP)
    const again = orchestrator.ensureSession(IMAGINE_APP)
    expect(again).toBe(first)
    expect(first.getSnapshot().source).toBe('network')
    expect(calls).toHaveLength(1)
  })

  it('keeps an imagine snapshot into kept (name=query) and serves kept-only ids after restart', async () => {
    const { fetcher } = makeTransport([sseDoc(DOC_HTML)])
    const cache = createEclosionCache()
    const orchestrator = makeOrchestrator(fetcher, cache)
    orchestrator.ensureImagineSession(IMAGINE_QUERY)
    await orchestrator.ensureSession(IMAGINE_APP)?.settled()

    // 未生成过的 imagine 前缀 id：无内存真身 → 拒绝获取，绝不触发生成。
    await expect(orchestrator.keepApp(imagineAppIdForQuery('不存在查询'))).resolves.toBe(false)

    await expect(orchestrator.keepApp(IMAGINE_APP)).resolves.toBe(true)
    const kept = await cache.readKept(user, IMAGINE_APP)
    expect(kept).toMatchObject({ appId: IMAGINE_APP, name: IMAGINE_QUERY, html: DOC_HTML })
    expect(useEclosionStore.getState().keptAppIds).toContain(IMAGINE_APP)

    // 跨重启：全新编排器（无会话内存）+ 登录恢复 → kept 快照即真身，零网络。
    // 登录会按持久化偏好 hydrate：先落盘「羽化开」，模拟真实留存用户。
    localStorage.setItem(
      `agehaos.eclosion.prefs.v1.${user}`,
      JSON.stringify({ enabled: true, modes: {} }),
    )
    const restored = new EclosionOrchestrator({ fetcher: makeTransport([]).fetcher, cache })
    restored.start()
    try {
      systemBus.emit('user.login', { userId: user })
      await vi.waitFor(() => expect(useEclosionStore.getState().keptAppIds).toContain(IMAGINE_APP))
      await vi.waitFor(() => expect(useEclosionStore.getState().enabled).toBe(true))
    } finally {
      restored.stop()
    }
    const session = restored.ensureSession(IMAGINE_APP)
    await session?.settled()
    expect(session?.getSnapshot()).toMatchObject({ phase: 'done', source: 'cache' })

    await expect(orchestrator.unkeepApp(IMAGINE_APP)).resolves.toBe(true)
    expect(await cache.readKept(user, IMAGINE_APP)).toBeNull()
    expect(useEclosionStore.getState().keptAppIds).not.toContain(IMAGINE_APP)
  })

  it('terminal failure has no native fallback (L3 错误卡口径) and clears on logout', async () => {
    const { fetcher, calls } = makeTransport([
      new Response(JSON.stringify({ error: 'quota-exceeded' }), { status: 429 }),
    ])
    const orchestrator = makeOrchestrator(fetcher)
    orchestrator.start()
    try {
      orchestrator.ensureImagineSession(IMAGINE_QUERY)
      const session = orchestrator.ensureSession(IMAGINE_APP)!
      await session.settled()
      // 429 非可重试码：直接终态（fellBack → 宿主渲染错误卡）。
      expect(orchestrator.requestRetry(IMAGINE_APP, 'run')).toBe(false)
      expect(session.getSnapshot()).toMatchObject({ phase: 'error', errorCode: 'quota-exceeded', fellBack: true })
      expect(calls).toHaveLength(1)

      // 登出：会话/注册清单/内存 HTML 整体清理；重开走全新管线（kept 源 + 未登录 → 终态失败，不再有内存真身）。
      systemBus.emit('user.logout', { userId: user })
      expect(getAppManifest(IMAGINE_APP)).toBeNull()
      const reopened = orchestrator.ensureSession(IMAGINE_APP)
      await reopened?.settled()
      expect(reopened?.getSnapshot()).toMatchObject({ phase: 'error', errorCode: 'not-authenticated' })
    } finally {
      orchestrator.stop()
    }
  })
})

// ── 举报与会话封禁（§10，P4 治理） ───────────────────────────────────────────

describe('EclosionOrchestrator × 举报与会话封禁（§10）', () => {
  const accepted = (): Response =>
    new Response(JSON.stringify({ status: 'accepted', id: 's-1', classification: 'ok' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })

  it('uploads name+tagline summary with the 2KB detail, then bans the session, closes the window and emits app.reported', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('app-01'),
      worldDate: today,
      slug: 'app-01',
      html: DOC_HTML,
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([accepted()])
    const orchestrator = makeOrchestrator(fetcher, cache)
    const reported = vi.fn()
    systemBus.on('eclosion.app.reported', reported)
    const windowId = useWindowStore.getState().open({ appId: TODAY_APP('app-01'), title: '应用零0' })

    await expect(orchestrator.reportApp(TODAY_APP('app-01'), windowId)).resolves.toBe(true)

    // 载荷形状（§10）：text=应用名+tagline 组合摘要、source 标记、detail=生成全文。
    expect(calls[0]?.url).toBe('/api/dynamic/samples')
    expect(calls[0]?.body).toEqual({
      text: '应用零0 · 一句话',
      source: 'eclosion',
      detail: DOC_HTML,
    })
    // 会话封禁：镜像入 store，本会话不可再打开。
    expect(useEclosionStore.getState().bannedAppIds).toContain(TODAY_APP('app-01'))
    expect(orchestrator.ensureSession(TODAY_APP('app-01'))).toBeNull()
    // 本地立即关窗 + 预留事件键（ADR 4 形状）。
    expect(useWindowStore.getState().windows.some((win) => win.id === windowId)).toBe(false)
    expect(reported).toHaveBeenCalledWith({ appId: TODAY_APP('app-01'), windowId })
    // 幂等：已封禁再举报直接成功且不再发请求。
    await expect(orchestrator.reportApp(TODAY_APP('app-01'), windowId)).resolves.toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('truncates the combined summary at 512 and the detail at 2048 (摘要截断)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    useEclosionStore.getState().applyWorld({
      worldDate: today,
      headline: '长文本世界',
      paletteId: 'nebula-violet',
      accentHue: 212,
      degraded: false,
      signalCount: 0,
      signals: { titles: [], sourceName: '', sourceUrl: '' },
      apps: [
        {
          slug: 'app-01',
          name: '名'.repeat(300),
          hue: 210,
          tagline: '介'.repeat(300),
          category: 'tools',
          window: { width: 720, height: 480 },
        },
      ],
    })
    const cache = createEclosionCache()
    const longHtml = `<html>${'x'.repeat(5000)}</html>`
    await cache.writeToday(user, {
      appId: TODAY_APP('app-01'),
      worldDate: today,
      slug: 'app-01',
      html: longHtml,
      createdAt: '',
    })
    const orchestrator = makeOrchestrator(vi.fn(), cache)

    const payload = await orchestrator.buildReportPayload(TODAY_APP('app-01'))

    expect(payload).not.toBeNull()
    expect(payload?.text.length).toBe(512)
    expect(payload?.text).toBe(`${'名'.repeat(300)} · ${'介'.repeat(300)}`.slice(0, 512))
    expect(payload?.source).toBe('eclosion')
    expect(payload?.detail.length).toBe(2048)
    expect(payload?.detail).toBe(longHtml.slice(0, 2048))
  })

  it('collects the summary per domain: basic=规格名缓存全文、imagine=query 会话全文、kept=快照', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(user, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 3,
      html: DOC_HTML,
      createdAt: '',
    })
    await cache.writeKept(user, {
      appId: TODAY_APP('kept-one'),
      name: '留存应用',
      html: DOC_HTML,
      createdAt: '',
    })
    const orchestrator = makeOrchestrator(vi.fn(), cache)

    // L1：规格表标题 + basic 缓存。
    await expect(orchestrator.buildReportPayload(CALCULATOR)).resolves.toEqual({
      text: '计算器',
      source: 'eclosion',
      detail: DOC_HTML,
    })
    // 留存：kept 快照（今日缓存缺失时的兜底同路）。
    await expect(orchestrator.buildReportPayload(TODAY_APP('kept-one'))).resolves.toEqual({
      text: '留存应用',
      source: 'eclosion',
      detail: DOC_HTML,
    })
    // L3：会话内 query 与生成全文（§8 只存内存）。
    const sse = makeTransport([sseDoc(DOC_HTML)])
    const imagining = makeOrchestrator(sse.fetcher, cache)
    const appId = imagining.ensureImagineSession('番茄钟')
    expect(appId).not.toBeNull()
    const session = imagining.ensureSession(appId as string)
    await session?.settled()
    await expect(imagining.buildReportPayload(appId as string)).resolves.toEqual({
      text: '番茄钟',
      source: 'eclosion',
      detail: DOC_HTML,
    })
    // 没见过生成内容（无缓存无会话）→ null：绝不触发新的生成。
    await expect(orchestrator.buildReportPayload(TODAY_APP('ghost'))).resolves.toBeNull()
  })

  it('keeps the app open and unbanned when the upload fails (可重试)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('app-02'),
      worldDate: today,
      slug: 'app-02',
      html: DOC_HTML,
      createdAt: '',
    })
    const { fetcher, calls } = makeTransport([
      new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }),
    ])
    const orchestrator = makeOrchestrator(fetcher, cache)
    const reported = vi.fn()
    systemBus.on('eclosion.app.reported', reported)
    const windowId = useWindowStore.getState().open({ appId: TODAY_APP('app-02'), title: '应用零1' })

    await expect(orchestrator.reportApp(TODAY_APP('app-02'), windowId)).resolves.toBe(false)

    expect(useEclosionStore.getState().bannedAppIds).toEqual([])
    expect(useWindowStore.getState().windows.some((win) => win.id === windowId)).toBe(true)
    expect(reported).not.toHaveBeenCalled()
    expect(orchestrator.ensureSession(TODAY_APP('app-02'))).not.toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('clears the session ban on stop/logout wiring (会话级，不跨登录)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    seedTodayWorld(today)
    const cache = createEclosionCache()
    await cache.writeToday(user, {
      appId: TODAY_APP('app-03'),
      worldDate: today,
      slug: 'app-03',
      html: DOC_HTML,
      createdAt: '',
    })
    const { fetcher } = makeTransport([accepted()])
    const orchestrator = makeOrchestrator(fetcher, cache)
    const windowId = useWindowStore.getState().open({ appId: TODAY_APP('app-03'), title: 'x' })
    await expect(orchestrator.reportApp(TODAY_APP('app-03'), windowId)).resolves.toBe(true)
    expect(useEclosionStore.getState().bannedAppIds).toHaveLength(1)

    orchestrator.stop() // 与 handleLogout 同一清理路径（clearBans）
    expect(useEclosionStore.getState().bannedAppIds).toEqual([])
    expect(orchestrator.ensureSession(TODAY_APP('app-03'))).not.toBeNull()
  })
})
