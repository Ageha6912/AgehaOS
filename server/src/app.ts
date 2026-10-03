import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyBaseLogger, FastifyError, FastifyInstance, FastifyLoggerOptions } from 'fastify'

import { loadConfig } from './config'
import type { ServerConfig } from './config'
import { originCheck } from './plugins/origin-check'
import type { RedisLike } from './rate-limit-redis'
import { aiRoutes } from './routes/ai'
import { authRoutes } from './routes/auth'
import { eclosionRoutes } from './routes/eclosion'
import { sampleRoutes } from './routes/samples'
import { storeRoutes } from './routes/store'
import { syncRoutes } from './routes/sync'
import { startWorldScheduler, type WorldSchedulerHandle } from './eclosion/scheduler'
import { GitHubTrendingRssSource, createTrendingService, type TrendingSource } from './eclosion/trending'
import { loadOrCreateSigningKey } from './store-keys'
import { createStore } from './store'
import type { DataStore } from './store'

export interface BuildAppOptions {
  /** Overrides for tests/dev; merged over loadConfig(). */
  config?: Partial<ServerConfig>
  /** Pre-built store (tests); built from config.store otherwise. */
  store?: DataStore
  /** Pre-built catalog signing key (tests); loaded from dataDir otherwise. */
  signingKey?: Awaited<ReturnType<typeof loadOrCreateSigningKey>>
  /** Fastify logger option; `false` quiets tests, a pino config for prod. */
  logger?: boolean | FastifyLoggerOptions
  /** Fastify loggerInstance 直通（测试注入 pino 实例捕获审计日志）。 */
  loggerInstance?: FastifyBaseLogger
  /** 测试注入：共享限流的 Redis 客户端（缺省按 config.redisUrl 动态 import ioredis）。 */
  redis?: RedisLike
  /** 测试注入的热点源（今日世界生成；缺省 GitHub Trending RSS，绝不真联网于测试）。 */
  eclosionTrending?: TrendingSource
}

/**
 * Normalizes every error response to `{ error: code }` so the frontend client
 * can map codes to AuthError values (PRD §30.5 input validation + audit).
 */
function normalizeError(error: FastifyError | Error): { code: number; body: Record<string, string> } {
  const fastifyError = error as FastifyError
  if (fastifyError.validation || fastifyError.code?.startsWith('FST_ERR_CTP')) {
    return { code: 400, body: { error: 'invalid-body' } }
  }
  if (fastifyError.statusCode === 429) {
    return { code: 429, body: { error: 'rate-limited' } }
  }
  if (fastifyError.statusCode !== undefined && fastifyError.statusCode < 500) {
    return { code: fastifyError.statusCode, body: { error: fastifyError.code ?? 'bad-request' } }
  }
  return { code: 500, body: { error: 'internal' } }
}

/**
 * Assembles the AgehaOS auth API: helmet headers, cookie parsing, per-route
 * rate limiting, CSRF origin checks and the /api/auth + /api/users routes.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const base = loadConfig()
  const config: ServerConfig = {
    ...base,
    ...options.config,
    rateLimit: { ...base.rateLimit, ...options.config?.rateLimit },
    ai: { ...base.ai, ...options.config?.ai },
    eclosion: { ...base.eclosion, ...options.config?.eclosion },
  }

  const app = Fastify({
    logger: options.loggerInstance === undefined ? (options.logger ?? false) : undefined,
    loggerInstance: options.loggerInstance,
    trustProxy: true,
  })

  await app.register(helmet)
  await app.register(cookie)
  if (options.redis ?? config.redisUrl) {
    // 多实例共享限流计数（ADR 21 附注）：AGEHA_REDIS_URL 或测试注入的 Redis 客户端。
    const { default: Redis } = await import('ioredis')
    const redis =
      options.redis ?? (new Redis(config.redisUrl as string) as unknown as RedisLike)
    const { redisRateLimitStoreCtor } = await import('./rate-limit-redis')
    await app.register(rateLimit, { global: false, store: redisRateLimitStoreCtor(redis) })
  } else {
    await app.register(rateLimit, { global: false })
  }

  const store = options.store ?? createStore(config)
  await store.init()
  // 今日世界热点源服务（§6.1）：内存 + DataStore 双层缓存；测试注入 fake source。
  const trending = createTrendingService({
    store,
    source:
      options.eclosionTrending ??
      new GitHubTrendingRssSource(config.eclosion.trendingUrl, config.eclosion.trendingTimeoutMs),
    ttlMs: config.eclosion.trendingTtlMs,
  })
  // 今日世界定时生成句柄（§9.2：见下方装配；onClose 统一清理）。
  let worldScheduler: WorldSchedulerHandle | null = null
  app.addHook('onClose', async () => {
    worldScheduler?.stop()
    await store.close()
  })

  app.setErrorHandler((error, _request, reply) => {
    const { code, body } = normalizeError(error as FastifyError)
    if (code >= 500) app.log.error({ err: error }, 'internal error')
    return reply.code(code).send(body)
  })

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'not-found' })
  })

  app.get('/api/health', async () => ({ ok: true }))

  // Root-scope hook so it applies to every /api route registered below
  // (registering it as a sibling plugin would encapsulate the hook away).
  await originCheck(app, { allowedOrigins: config.allowedOrigins })
  await app.register(authRoutes, {
    prefix: '/api',
    store,
    sessionTtlMs: config.sessionTtlMs,
    cookieSecure: config.cookieSecure,
    rateLimit: config.rateLimit,
  })
  await app.register(aiRoutes, {
    prefix: '/api',
    ai: config.ai,
    rateLimitWindowMs: config.rateLimit.windowMs,
  })
  await app.register(syncRoutes, { prefix: '/api', store })

  // 羽化模式生成管线（AI-GENERATED-APPS-DESIGN §5.3/§6/§9）：SSE 流式 + 结构闸
  // + 额度/限流/全局缓存；GET /world 全局按日 + 个人重生成；AGEHA_ECLOSION_*
  // 回退 AGEHA_AI_*，Key 永不出服务端。
  await app.register(eclosionRoutes, {
    prefix: '/api',
    store,
    eclosion: config.eclosion,
    trending,
    rateLimitWindowMs: config.rateLimit.windowMs,
  })

  // 举报样本上传（DDS §8.6）：匿名上报 + 服务端分类器，复审清单仅 admin。
  await app.register(sampleRoutes, {
    prefix: '/api',
    store,
    rateLimitWindowMs: config.rateLimit.windowMs,
  })

  // 远端应用目录（PRD §47 前置切片）：Ed25519 签名密钥落在数据目录，重启不变。
  const signingKey =
    options.signingKey ?? (await loadOrCreateSigningKey(config.dataDir))
  await app.register(storeRoutes, { prefix: '/api', signingKey, store })

  // ADR 20（评审 2026-10-02 P0-1 修订）：admin 角色的唯一授权路径——启动时
  // 对 AGEHA_ADMIN_USERNAME 同名的既有用户幂等提升。注册时不再授予（防
  // 访客抢注引导用户名）；流程 = 先注册普通账号，重启服务后被提升。
  if (config.adminUsername) {
    const admin = await store.findUserByUsername(config.adminUsername)
    if (admin && admin.role !== 'admin') {
      await store.updateUser({ ...admin, role: 'admin' })
      app.log.info({ audit: 'admin.promote', userId: admin.id }, 'admin role granted at boot')
    }
  }

  // 今日世界定时生成（§9.2 触发表第一行）：服务端首个进程内定时器——启动检查
  // 一次（不阻塞启动）+ 每 interval 查 UTC 日跨日即生成；unref 不阻塞退出，
  // onClose 清理；与 GET /world 懒触发共用 DataStore 单飞锁（多实例安全）。
  if (config.eclosion.worldSchedulerEnabled) {
    worldScheduler = startWorldScheduler({
      store,
      eclosion: config.eclosion,
      trending,
      logger: app.log,
      intervalMs: config.eclosion.worldSchedulerIntervalMs,
    })
  }

  return app
}
