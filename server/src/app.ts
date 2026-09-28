import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyError, FastifyInstance, FastifyLoggerOptions } from 'fastify'

import { loadConfig } from './config'
import type { ServerConfig } from './config'
import { originCheck } from './plugins/origin-check'
import type { RedisLike } from './rate-limit-redis'
import { aiRoutes } from './routes/ai'
import { authRoutes } from './routes/auth'
import { sampleRoutes } from './routes/samples'
import { storeRoutes } from './routes/store'
import { syncRoutes } from './routes/sync'
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
  /** 测试注入：共享限流的 Redis 客户端（缺省按 config.redisUrl 动态 import ioredis）。 */
  redis?: RedisLike
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
  }

  const app = Fastify({ logger: options.logger ?? false, trustProxy: true })

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
  app.addHook('onClose', async () => {
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
    adminUsername: config.adminUsername,
  })
  await app.register(aiRoutes, {
    prefix: '/api',
    ai: config.ai,
    rateLimitWindowMs: config.rateLimit.windowMs,
  })
  await app.register(syncRoutes, { prefix: '/api', store })

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

  // ADR 20：管理员引导提升（幂等）——已存在同名用户时每次启动补授角色，
  // 使 AGEHA_ADMIN_USERNAME 在既有库上也可追溯生效。
  if (config.adminUsername) {
    const admin = await store.findUserByUsername(config.adminUsername)
    if (admin && admin.role !== 'admin') {
      await store.updateUser({ ...admin, role: 'admin' })
      app.log.info({ audit: 'admin.promote', userId: admin.id }, 'admin role granted at boot')
    }
  }

  return app
}
