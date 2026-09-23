import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyError, FastifyInstance } from 'fastify'

import { loadConfig } from './config'
import type { ServerConfig } from './config'
import { originCheck } from './plugins/origin-check'
import { aiRoutes } from './routes/ai'
import { authRoutes } from './routes/auth'
import { createStore } from './store'
import type { DataStore } from './store'

export interface BuildAppOptions {
  /** Overrides for tests/dev; merged over loadConfig(). */
  config?: Partial<ServerConfig>
  /** Pre-built store (tests); built from config.store otherwise. */
  store?: DataStore
  /** Fastify logger option; `false` quiets tests, a pino config for prod. */
  logger?: boolean | Record<string, unknown>
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
  await app.register(rateLimit, { global: false })

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
  })
  await app.register(aiRoutes, {
    prefix: '/api',
    ai: config.ai,
    rateLimitWindowMs: config.rateLimit.windowMs,
  })

  return app
}
