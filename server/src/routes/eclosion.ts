import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { EclosionConfig } from '../config'
import { classifyContentText } from '../classifier'
import { StreamingHtmlGate } from '../eclosion/html-gate'
import {
  ECLOSION_BUDGET_KEY,
  ECLOSION_DAILY_LIMITS,
  budgetReservationTokens,
  eclosionUsageKey,
  nextUtcMidnightIso,
  readQuotaSnapshot,
  reserveEclosionQuota,
  utcDayKey,
  type EclosionQuotaLease,
} from '../eclosion/quota'
import {
  buildBasicMessages,
  buildImagineMessages,
  buildTodayAppMessages,
  imagineQueryHash,
} from '../eclosion/prompts'
import { basicCacheKey, findBasicSpec } from '../eclosion/spec'
import type { TrendingService } from '../eclosion/trending'
import { estimateTokens, streamEclosionCompletion } from '../eclosion/upstream'
import {
  ensureWorldForDay,
  parseStoredWorld,
  publicWorldPayload,
  synthesizeWorld,
  todayCacheKey,
  worldGlobalKey,
  worldPersonalGenLockKey,
  worldPersonalKey,
  worldLockTtlMs,
  type WorldAppLine,
  type WorldRecord,
} from '../eclosion/world'
import type { DataStore, UserRecord } from '../store/types'
import { SESSION_COOKIE } from './auth'

/**
 * 羽化模式接口（AI-GENERATED-APPS-DESIGN §5.3/§6/§7/§9）：
 * - POST /eclosion/generate：SSE 流式生成 + 结构闸 + 额度/限流/全局缓存/单飞锁
 *   （kind=basic L1 三件套；kind=today L2 今日应用；kind=imagine L3 想象搜索
 *   ——query ≤60 字、先过 classifier（violation 422）、包裹固定模板、恒个人版
 *   不读不写全局缓存、imagine 档每日 20 次）。
 * - GET /eclosion/world：当日世界（个人版优先，全局按日生成一次，懒触发）。
 * - POST /eclosion/world/regenerate：个人世界重生成（耗 today 档额度，不写全局）。
 *
 * 错误契约：generate 在 SSE 开始前用普通 JSON 错误（401/422/429/503），开始后
 * 用 `error` 事件；world 两端点为普通 JSON。客户端断开（关窗）即 AbortController
 * 中止上游，不空烧 token；超时独立走 AGEHA_ECLOSION_TIMEOUT_MS（默认 240s）。
 *
 * 审计：pino `eclosion.generate { userId, kind, model, bytes, ms, outcome }` 与
 * `eclosion.world { userId, day, outcome, ms, tokens? }`；外链移除另记
 * `eclosion.external_link`（样本截断 96 字符）。query 原文不进任何日志（§9.3：
 * 只在被举报时进入样本库），imagine 审计以 queryHash（规范化 SHA-256 前 8 位）
 * 关联。
 */

export interface EclosionRoutesOptions {
  store: DataStore
  eclosion: EclosionConfig
  rateLimitWindowMs: number
  /** 热点源服务（今日世界生成用；app.ts 装配，测试注入 fake source）。 */
  trending: TrendingService
  /** 测试注入的上游传输；缺省全局 fetch。 */
  fetcher?: typeof fetch
  /** 单飞锁等待轮询间隔（默认 250ms；测试调小加速）。 */
  lockPollMs?: number
}

interface GenerateBody {
  kind: 'basic' | 'today' | 'imagine'
  specId?: string
  worldDate?: string
  slug?: string
  query?: string
  locale: 'zh-CN' | 'en'
  theme: 'light' | 'dark'
  /** 重新羽化：跳过全局缓存读取，且结果不回写全局缓存（§9.2 个人版本）。 */
  regenerate?: boolean
}

const GENERATE_BODY_SCHEMA = {
  type: 'object',
  required: ['kind', 'locale', 'theme'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['basic', 'today', 'imagine'] },
    specId: { type: 'string', minLength: 1, maxLength: 64 },
    worldDate: { type: 'string', minLength: 8, maxLength: 10 },
    slug: { type: 'string', minLength: 1, maxLength: 64 },
    query: { type: 'string', minLength: 1, maxLength: 60 },
    locale: { type: 'string', enum: ['zh-CN', 'en'] },
    theme: { type: 'string', enum: ['light', 'dark'] },
    regenerate: { type: 'boolean' },
  },
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

export async function eclosionRoutes(
  app: FastifyInstance,
  options: EclosionRoutesOptions,
): Promise<void> {
  const { store, eclosion, trending } = options
  const fetcher = options.fetcher ?? fetch
  const lockPollMs = options.lockPollMs ?? 250

  /** 会话门（照 sync.ts 范式）；额外取 user 记录（admin 额度豁免判定）。 */
  const requireUser = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<UserRecord | null> => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) {
      await reply.code(401).send({ error: 'not-authenticated' })
      return null
    }
    const session = await store.findSession(token)
    if (!session || session.expiresAt <= Date.now()) {
      await reply.code(401).send({ error: 'not-authenticated' })
      return null
    }
    const user = await store.findUserById(session.userId)
    if (!user) {
      await reply.code(401).send({ error: 'not-authenticated' })
      return null
    }
    return user
  }

  const sessionRateLimit = {
    // §9.3：6/min/用户。key 用会话 cookie token（onRequest 阶段可同步取到，
    // 登录会话 1:1 用户；token 不落日志）。
    rateLimit: {
      max: 6,
      timeWindow: options.rateLimitWindowMs,
      keyGenerator: (request: FastifyRequest) => request.cookies[SESSION_COOKIE] ?? request.ip,
    },
  }

  /** 当日世界解析：个人重生成版优先，其次全局（§6.2/§11-1）。 */
  const resolveExistingWorld = async (
    userId: string,
    day: string,
  ): Promise<WorldRecord | null> => {
    const personal = await store.getEclosionCache(worldPersonalKey(day, userId))
    if (personal !== null) {
      const record = parseStoredWorld(personal, day)
      if (record !== null) return record
    }
    const globalRaw = await store.getEclosionCache(worldGlobalKey(day))
    if (globalRaw !== null) {
      const record = parseStoredWorld(globalRaw, day)
      if (record !== null) return record
    }
    return null
  }

  app.get('/eclosion/quota', async (request, reply) => {
    const user = await requireUser(request, reply)
    if (!user) return reply
    // 未配置 Key → 200 configured:false（Settings 开关置灰依据）。设计 §9.1 的
    // 「/api/eclosion/* 503」对 generate 严格生效；quota 作为探测端点返回快照。
    const snapshot = await readQuotaSnapshot(store, user.id, eclosion.apiKey !== null)
    return reply.code(200).send(snapshot)
  })

  // ── GET /eclosion/world：当日世界（全局按日一次 + 个人版优先，§6.2） ──────

  app.get('/eclosion/world', async (request, reply) => {
    const startedAt = Date.now()
    const user = await requireUser(request, reply)
    if (!user) return reply
    if (!eclosion.apiKey) {
      return reply.code(503).send({ error: 'ai-not-configured' })
    }
    const day = utcDayKey()

    const personal = await store.getEclosionCache(worldPersonalKey(day, user.id))
    if (personal !== null) {
      const record = parseStoredWorld(personal, day)
      if (record !== null) {
        app.log.info(
          { audit: 'eclosion.world', userId: user.id, day, outcome: 'personal', ms: Date.now() - startedAt },
          'world served (personal variant)',
        )
        return reply.code(200).send(publicWorldPayload(record))
      }
    }

    const ensured = await ensureWorldForDay({
      store,
      eclosion,
      trending,
      fetcher,
      day,
      pollMs: lockPollMs,
    })
    if (ensured.outcome === 'failed') {
      app.log.warn(
        {
          audit: 'eclosion.world',
          userId: user.id,
          day,
          outcome: 'failed',
          code: ensured.code,
          ms: Date.now() - startedAt,
        },
        'world generation failed',
      )
      return reply.code(503).send({ error: 'world-unavailable' })
    }
    app.log.info(
      {
        audit: 'eclosion.world',
        userId: user.id,
        day,
        outcome: ensured.outcome,
        ms: Date.now() - startedAt,
        ...(ensured.outcome === 'generated' ? { tokens: ensured.tokens } : {}),
      },
      'world served',
    )
    return reply.code(200).send(publicWorldPayload(ensured.record))
  })

  // ── POST /eclosion/world/regenerate：个人世界重生成（耗 today 档，§11-1）──

  app.post(
    '/eclosion/world/regenerate',
    { config: sessionRateLimit },
    async (request, reply) => {
      const startedAt = Date.now()
      const user = await requireUser(request, reply)
      if (!user) return reply
      if (!eclosion.apiKey) {
        return reply.code(503).send({ error: 'ai-not-configured' })
      }
      const day = utcDayKey()

      // 额度（§9.3）：全局 token 预算硬顶 + 个人 today 档（世界重生成归入
      // 今日应用档，2026-10-02 裁决；admin 不受个人额度但计入全局）。
      const budgetUsed = await store.getEclosionDaily(ECLOSION_BUDGET_KEY, day)
      if (budgetUsed >= eclosion.dailyTokenBudget) {
        return reply.code(429).send({
          error: 'quota-exceeded',
          scope: 'global',
          resetAtIso: nextUtcMidnightIso(),
        })
      }
      // 预检读数只负责快速 429；真正准入以原子预占为准（A3 审查 TOCTOU：
      // 并发请求在 used = limit-1 时只有一个能占到位）。管理员不占个人额度。
      let personalLease: EclosionQuotaLease | null = null
      if (user.role !== 'admin') {
        const used = await store.getEclosionDaily(eclosionUsageKey(user.id, 'today'), day)
        if (used >= ECLOSION_DAILY_LIMITS.today) {
          return reply.code(429).send({
            error: 'quota-exceeded',
            scope: 'today',
            used,
            limit: ECLOSION_DAILY_LIMITS.today,
            resetAtIso: nextUtcMidnightIso(),
          })
        }
        personalLease = await reserveEclosionQuota(
          store,
          eclosionUsageKey(user.id, 'today'),
          day,
          ECLOSION_DAILY_LIMITS.today,
          1,
        )
        if (!personalLease) {
          const usedNow = await store.getEclosionDaily(eclosionUsageKey(user.id, 'today'), day)
          return reply.code(429).send({
            error: 'quota-exceeded',
            scope: 'today',
            used: usedNow,
            limit: ECLOSION_DAILY_LIMITS.today,
            resetAtIso: nextUtcMidnightIso(),
          })
        }
      }

      // 个人单飞锁（A3 审查轻微项）：额度预占之后、真实生成之前——同用户双击
      // 只跑一次真实上游生成；显式传 day 消除 synthesizeWorld 内部重算的跨零点
      // 漂移。成功/失败/异常都释放。
      const genLock = worldPersonalGenLockKey(day, user.id)
      const lockHolder = `regen:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
      if (
        !(await store.acquireEclosionLock(genLock, lockHolder, worldLockTtlMs(eclosion.timeoutMs)))
      ) {
        await personalLease?.release().catch(() => undefined)
        return reply.code(409).send({ error: 'world-in-progress' })
      }

      let synthesized: Awaited<ReturnType<typeof synthesizeWorld>>
      try {
        synthesized = await synthesizeWorld({ store, eclosion, trending, fetcher, day })
      } finally {
        await store.releaseEclosionLock(genLock, lockHolder).catch(() => undefined)
      }
      if (!synthesized.ok) {
        // 未产出可交付结果：退还预占（与既有「失败不计次」语义一致）。
        await personalLease?.release().catch(() => undefined)
        app.log.warn(
          {
            audit: 'eclosion.world',
            userId: user.id,
            day,
            outcome: 'failed',
            code: synthesized.code,
            detail: synthesized.detail,
            ms: Date.now() - startedAt,
          },
          'personal world regeneration failed',
        )
        return reply.code(503).send({ error: 'world-unavailable', code: synthesized.code })
      }

      // 个人版本：只写个人键，绝不回写全局缓存（§6.2/§9.2）。today 档已在
      // 预占时计入，无需再自增。
      await store.putEclosionCache(worldPersonalKey(day, user.id), JSON.stringify(synthesized.record))
      app.log.info(
        {
          audit: 'eclosion.world',
          userId: user.id,
          day,
          outcome: 'regenerated',
          tokens: synthesized.tokens,
          attempts: synthesized.attempts,
          ms: Date.now() - startedAt,
        },
        'personal world regenerated',
      )
      return reply.code(200).send(publicWorldPayload(synthesized.record))
    },
  )

  // ── POST /eclosion/generate：SSE 流式生成（§5.3/§9） ─────────────────────

  app.post(
    '/eclosion/generate',
    {
      schema: { body: GENERATE_BODY_SCHEMA },
      config: sessionRateLimit,
    },
    async (request, reply) => {
      const startedAt = Date.now()
      const user = await requireUser(request, reply)
      if (!user) return reply
      const body = request.body as GenerateBody

      // ── SSE 开始前的硬校验（JSON 错误） ─────────────────────────────
      const day = utcDayKey()
      let spec = null as ReturnType<typeof findBasicSpec>
      let worldApp: WorldAppLine | null = null
      let imagineQuery: string | null = null
      if (body.kind === 'basic') {
        spec = findBasicSpec(body.specId ?? '')
        if (!spec) {
          return reply.code(422).send({ error: 'unknown-spec' })
        }
      } else if (body.kind === 'today') {
        // L2：worldDate 必须是**今日**世界（§5.3/§6.4：次日整体换新）。
        if (body.worldDate !== day) {
          return reply.code(422).send({ error: 'invalid-world-date' })
        }
      } else {
        // L3 想象搜索（§7）：query ≤60 字、非空白；violation → 422（照 samples
        // 模式，违规内容本体不入任何存储）。
        const trimmed = (body.query ?? '').trim()
        if (trimmed.length === 0 || trimmed.length > 60) {
          return reply.code(422).send({ error: 'invalid-query' })
        }
        if (classifyContentText(trimmed).classification === 'violation') {
          return reply.code(422).send({ error: 'content-rejected' })
        }
        imagineQuery = trimmed
      }
      if (!eclosion.apiKey) {
        return reply.code(503).send({ error: 'ai-not-configured' })
      }
      if (body.kind === 'today') {
        // 世界清单是唯一事实源（ADR 27：slug 不带 hint 上行，服务端按世界行取）。
        const world = await resolveExistingWorld(user.id, day)
        if (!world) {
          return reply.code(422).send({ error: 'unknown-world' })
        }
        worldApp = world.apps.find((app) => app.slug === (body.slug ?? '')) ?? null
        if (!worldApp) {
          return reply.code(422).send({ error: 'unknown-slug' })
        }
      }

      const regenerate = body.regenerate === true
      const budgetUsed = await store.getEclosionDaily(ECLOSION_BUDGET_KEY, day)
      if (budgetUsed >= eclosion.dailyTokenBudget) {
        return reply.code(429).send({
          error: 'quota-exceeded',
          scope: 'global',
          resetAtIso: nextUtcMidnightIso(),
        })
      }
      if (user.role !== 'admin') {
        const used = await store.getEclosionDaily(eclosionUsageKey(user.id, body.kind), day)
        if (used >= ECLOSION_DAILY_LIMITS[body.kind]) {
          return reply.code(429).send({
            error: 'quota-exceeded',
            scope: body.kind,
            used,
            limit: ECLOSION_DAILY_LIMITS[body.kind],
            resetAtIso: nextUtcMidnightIso(),
          })
        }
      }

      // ── 切入 SSE：meta 必为首帧（§5.3 事件序列） ─────────────────────
      reply.hijack()
      reply.raw.writeHead(200, SSE_HEADERS)
      const requestId = randomUUID()
      const model = eclosion.model

      // 客户端断开侦测必须在 hijack 后立即注册、先于本函数内一切 await
      // （§5.3）：断开可能发生在缓存读取或单飞锁等待（最长 timeoutMs）期间，
      // close 事件一旦 emit，后注册的监听器收不到——上游会照常完整生成一次。
      let clientClosed = false
      let upstreamController: AbortController | null = null
      const onClientClose = (): void => {
        // Node ≥16 里 request.raw 在请求体读毕即 emit 'close'（与连接无关），
        // 真正的「客户端断开」信号是 response 的 close 且响应尚未写完。
        if (reply.raw.writableEnded) return
        clientClosed = true
        upstreamController?.abort()
      }
      reply.raw.on('close', onClientClose)

      const write = (event: string, data: unknown): void => {
        if (!reply.raw.writableEnded) {
          try {
            reply.raw.write(sseFrame(event, data))
          } catch {
            /* 客户端已断开：写入失败静默，中止由 close 钩子负责 */
          }
        }
      }
      const finish = (): void => {
        // 所有收尾路径都经 finish：统一摘除 close 钩子（含缓存命中/锁等待
        // 这些不进生成段的分支）。
        reply.raw.off('close', onClientClose)
        if (!reply.raw.writableEnded) {
          try {
            reply.raw.end()
          } catch {
            /* 同上 */
          }
        }
      }
      const kindDetail =
        body.kind === 'basic'
          ? { specId: (spec as NonNullable<typeof spec>).specId }
          : body.kind === 'today'
            ? { worldDate: day, slug: body.slug ?? '' }
            : // imagine：只记 queryHash——query 原文不进任何日志（§9.3）。
              { queryHash: imagineQueryHash(imagineQuery ?? '') }
      const audit = (fields: Record<string, unknown>, outcome: string): void => {
        app.log.info(
          {
            audit: 'eclosion.generate',
            userId: user.id,
            kind: body.kind,
            model,
            ms: Date.now() - startedAt,
            outcome,
            ...kindDetail,
            ...fields,
          },
          'eclosion generate finished',
        )
      }
      write('meta', { requestId, model })

      // imagine 恒个人版（§9.2）：不读不写全局缓存、无单飞锁——cacheKey 仅作
      // 审计/日志关联占位，从不落缓存面。
      const personal = body.kind === 'imagine'
      const cacheKey =
        body.kind === 'basic'
          ? basicCacheKey(spec as NonNullable<typeof spec>, model)
          : body.kind === 'today'
            ? todayCacheKey(day, body.slug ?? '', model)
            : `imagine:${user.id}:${imagineQueryHash(imagineQuery ?? '')}`
      const serveHtml = (html: string, outcome: string, cached: boolean): void => {
        if (html.length > 0) write('delta', { text: html })
        write('done', { bytes: Buffer.byteLength(html), ms: Date.now() - startedAt, cached })
        audit({ bytes: Buffer.byteLength(html), cached }, outcome)
        finish()
      }

      // 全局缓存（§9.2）：命中即秒回且不耗额度；重新羽化跳过读取；imagine 恒
      // 个人版本——不读不写全局缓存（会话内复用由客户端编排器负责）。
      if (!regenerate && !personal) {
        const cachedHtml = await store.getEclosionCache(cacheKey)
        if (cachedHtml !== null) {
          serveHtml(cachedHtml, 'cache', true)
          return reply
        }
      }

      // 单飞锁（§9.2）：同一 key 同一时间只生成一次；竞争者轮询缓存等结果。
      // 次序是 acquire → 再读缓存：若先读缓存再抢锁，对端可能在两步之间写完
      // 缓存并释放锁，本请求会抢到锁重复生成（check-then-act 竞态）。
      // imagine 无共享缓存可等——个人版本直连生成，不参与单飞。
      const holder = randomUUID()
      const lockTtlMs = eclosion.timeoutMs + 10_000
      const waitDeadline = Date.now() + eclosion.timeoutMs
      const acquireOrServeCache = async (): Promise<'served' | 'acquired' | 'contended'> => {
        if (await store.acquireEclosionLock(cacheKey, holder, lockTtlMs)) {
          // 抢到锁也可能撞上对端刚写完的缓存：命中即让出锁直接服务。
          // 重新羽化除外——它的语义就是弃缓存重生成，不吃对端结果。
          if (!regenerate) {
            const cachedHtml = await store.getEclosionCache(cacheKey)
            if (cachedHtml !== null) {
              await store.releaseEclosionLock(cacheKey, holder)
              serveHtml(cachedHtml, 'cache', true)
              return 'served'
            }
          }
          return 'acquired'
        }
        return 'contended'
      }
      let state: 'served' | 'acquired' | 'contended' = personal ? 'acquired' : await acquireOrServeCache()
      while (state === 'contended') {
        if (clientClosed || Date.now() >= waitDeadline) break
        await delay(lockPollMs)
        if (clientClosed) break
        state = await acquireOrServeCache()
      }
      const acquired = state === 'acquired'
      if (state === 'served') return reply
      if (clientClosed) {
        // 断开发生在缓存读取/锁等待期间：对端已收不到结果，绝不再生成。
        // 若这次轮询恰好抢到了锁，让出（对端无需等 TTL）。
        if (acquired) await store.releaseEclosionLock(cacheKey, holder).catch(() => {})
        audit({}, 'aborted')
        finish()
        return reply
      }
      if (!acquired) {
        // 对端超时仍未释放：不重复生成（成本护栏优先），按超时口径让客户端回落。
        write('error', { code: 'ai-timeout' })
        audit({}, 'lock-wait-timeout')
        finish()
        return reply
      }

      // ── 原子额度预占（A3 审查，§9.3）────────────────────────────────
      // 上方的额度读数只负责快速 429；真正准入以原子预占为准：并发请求在
      // used = limit-1 时会同时通过读数，但只有上限个能拿到租约（其余在此
      // 收到 error 帧）。预占放在缓存/单飞等待之后——命中缓存或吃到对端结果
      // 的请求不产生任何计数写入。个人额度占 1 次；全局预算预占单次生成上限，
      // 结束后按上游实际用量多退少补。
      let personalLease: EclosionQuotaLease | null = null
      if (user.role !== 'admin') {
        personalLease = await reserveEclosionQuota(
          store,
          eclosionUsageKey(user.id, body.kind),
          day,
          ECLOSION_DAILY_LIMITS[body.kind],
          1,
        )
        if (!personalLease) {
          write('error', { code: 'quota-exceeded' })
          audit({ scope: body.kind }, 'quota-exceeded')
          finish()
          return reply
        }
      }
      const budgetLease = await reserveEclosionQuota(
        store,
        ECLOSION_BUDGET_KEY,
        day,
        eclosion.dailyTokenBudget,
        budgetReservationTokens(eclosion.maxTokens, eclosion.dailyTokenBudget, budgetUsed),
      )
      if (!budgetLease) {
        await personalLease?.release().catch(() => undefined)
        write('error', { code: 'quota-exceeded' })
        audit({ scope: 'global' }, 'quota-exceeded')
        finish()
        return reply
      }

      // ── 真实生成：流式 + 结构闸 + 断开/超时中止 ──────────────────────
      const messages =
        body.kind === 'basic'
          ? buildBasicMessages(spec as NonNullable<typeof spec>, body.locale)
          : body.kind === 'imagine'
            ? buildImagineMessages(imagineQuery ?? '', body.locale)
            : buildTodayAppMessages(
              {
                slug: worldApp?.slug ?? '',
                name: worldApp?.name ?? '',
                tagline: worldApp?.tagline ?? '',
                category: worldApp?.category ?? '',
                hint: worldApp?.hint ?? '',
                window: worldApp?.window ?? { width: 720, height: 480 },
              },
              body.locale,
            )
      const promptChars = JSON.stringify(messages).length
      const controller = new AbortController()
      // 交给 hijack 后立即注册的 close 钩子：此后任何时刻断开都会中止它。
      upstreamController = controller
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, eclosion.timeoutMs)

      const gate = new StreamingHtmlGate()
      let thinkChars = 0
      // 上游实际收到的字符数（思考+正文，原始增量）：断开/超时/上游错路径没有
      // usage 回报，按它估算本次已耗费的 token——内容一旦经 delta 交付，任何
      // 收尾方式都不得免单。
      let streamedChars = 0
      let upstreamUsageTokens: number | null = null
      try {
        const result = await streamEclosionCompletion({
          fetcher,
          config: eclosion,
          messages,
          signal: controller.signal,
          callbacks: {
            onReasoningDelta: (text) => {
              streamedChars += text.length
              thinkChars += text.length
              // text = 思考流增量：客户端折叠面板展示尾迹；旧客户端只读
              // chars，多出的字段天然兼容。
              write('think', { chars: thinkChars, text })
            },
            onContentDelta: (text) => {
              streamedChars += text.length
              const safe = gate.push(text)
              if (safe.length > 0) write('delta', { text: safe })
            },
          },
        })
        upstreamUsageTokens = result.usageTokens

        const final = gate.finalize()
        if (final.removedSamples.length > 0) {
          app.log.warn(
            {
              audit: 'eclosion.external_link',
              userId: user.id,
              kind: body.kind,
              ...kindDetail,
              count: final.removedSamples.length,
              samples: final.removedSamples,
            },
            'external references stripped from generated html',
          )
        }
        const bytes = Buffer.byteLength(final.html)
        if (final.invalid) {
          write('error', { code: 'invalid-output' })
          audit({ bytes, reason: final.reason }, 'invalid-output')
        } else {
          // holdback 冲净：最后一个 delta 补齐 flush，客户端拼流 == 缓存全文。
          // 尾部已被流式下发又被剥除（围栏/</html> 后垃圾）时纯增量撤不回——
          // 发整文替换帧（A3 审查轻微项），否则客户端拼流 ≠ 缓存全文。
          if (final.overshoot > 0) write('replace', { html: final.html })
          else if (final.flush.length > 0) write('delta', { text: final.flush })
          write('done', { bytes, ms: Date.now() - startedAt, cached: false })
          const outcome = regenerate ? 'regenerated' : 'generated'
          // imagine（personal）绝不回写全局缓存（§9.2 个人版本）。
          if (!regenerate && !personal) await store.putEclosionCache(cacheKey, final.html)
          audit({ bytes, cached: false, thinkChars }, outcome)
        }
      } catch (cause) {
        if (isAbortError(cause)) {
          if (timedOut) {
            write('error', { code: 'ai-timeout' })
            audit({}, 'ai-timeout')
          } else {
            // 客户端断开：连接已不可写，审计后静默收尾（不写 error 帧）。
            audit({}, 'aborted')
          }
        } else {
          write('error', { code: 'ai-upstream' })
          app.log.warn(
            {
              audit: 'eclosion.upstream_error',
              userId: user.id,
              kind: body.kind,
              ...kindDetail,
              detail: cause instanceof Error ? cause.message : String(cause),
            },
            'eclosion upstream failed',
          )
          audit({}, 'ai-upstream')
        }
      } finally {
        clearTimeout(timer)
        reply.raw.off('close', onClientClose)
        if (!personal) await store.releaseEclosionLock(cacheKey, holder).catch(() => {})
        // 真实上游生成已发起即计费（§9.3）：个人额度已在预占时计入（1 次）；
        // 全局 token 预算按上游 usage（缺省按提示词+已收流估算）结算预占租约
        // （多退少补，跨 UTC 零点按**计费时刻**的日键重算）。放在 finally——
        // done / invalid-output / ai-timeout / ai-upstream / 客户端断开（内容可能
        // 已部分或全部经 delta 交付）一律计入，「收到内容即断开」不能绕过额度
        // （admin 计全局不设个人限额）。缓存命中与锁等待路径不预占，天然不计。
        const tokens = upstreamUsageTokens ?? estimateTokens(promptChars, streamedChars)
        // 计费写入失败不得穿出 finally（A3 审查）：否则 finish() 被跳过，
        // hijack 后的 SSE 永不 end（客户端挂到自身超时），且异常冒泡成 500。
        try {
          await budgetLease?.settle(tokens, utcDayKey())
        } catch (cause) {
          app.log.warn(
            { audit: 'eclosion.quota_write_failed', error: String(cause) },
            'eclosion quota accounting failed',
          )
        }
      }
      finish()
      return reply
    },
  )
}
