import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { SESSION_COOKIE } from './auth'
import type { DataStore } from '../store/types'

export interface SyncRoutesOptions {
  store: DataStore
}

interface SyncBody {
  data: string
}

const SYNC_SCHEMA = {
  type: 'object',
  required: ['data'],
  additionalProperties: false,
  properties: {
    data: { type: 'string', minLength: 1, maxLength: 256 * 1024 },
  },
}

/**
 * Per-user sync storage (PRD §35 用户配置同步 + Phase 3 云文件切片)：the server
 * is a dumb, authenticated, per-domain KV — the client owns merging (boot pull,
 * debounced push, whole-blob last-writer-wins). Domains: `settings`
 * (configuration) and `files` (text VFS snapshot). The unkeyed `/sync/data`
 * routes remain as the `settings` alias for existing clients.
 */

/** Sync domain names: lowercase identifiers, no separators. */
const SYNC_DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

export function isSyncDomain(value: string): boolean {
  return SYNC_DOMAIN_PATTERN.test(value)
}

/**
 * 每用户同步域上限（A1 审查）：域名模式允许任意数量新域，每个 ≤256KB，
 * 认证用户可脚本化无界膨胀 pg 表/文件存储。PRD §35 实际只需 settings/files
 * 两域；保留余量防未来切片，已存在域不受影响。
 */
export const MAX_SYNC_DOMAINS_PER_USER = 8

export async function syncRoutes(app: FastifyInstance, options: SyncRoutesOptions): Promise<void> {
  const { store } = options

  /** 写路由按会话限流（A1 审查：sync 在 global:false 下无默认限流）。 */
  const writeRateLimit = {
    rateLimit: {
      max: 120,
      timeWindow: 60_000,
      keyGenerator: (request: FastifyRequest) => request.cookies[SESSION_COOKIE] ?? request.ip,
    },
  }

  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
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
    return session.userId
  }

  const parseDomain = (request: FastifyRequest, reply: FastifyReply): string | null => {
    const domain = (request.params as { domain?: string }).domain ?? 'settings'
    if (!isSyncDomain(domain)) {
      void reply.code(400).send({ error: 'invalid-sync-domain' })
      return null
    }
    return domain
  }

  app.get('/sync/data', async (request, reply) => {
    const userId = await requireUser(request, reply)
    if (!userId) return reply
    const data = await store.getSyncData(userId, 'settings')
    return reply.code(200).send({ data })
  })

  app.put(
    '/sync/data',
    { schema: { body: SYNC_SCHEMA }, config: writeRateLimit },
    async (request, reply) => {
      const userId = await requireUser(request, reply)
      if (!userId) return reply
      const { data } = request.body as SyncBody
      await store.putSyncData(userId, 'settings', data)
      app.log.info({ audit: 'sync.put', userId }, 'sync data stored')
      return reply.code(200).send({ ok: true })
    },
  )

  app.get('/sync/data/:domain', async (request, reply) => {
    const userId = await requireUser(request, reply)
    if (!userId) return reply
    const domain = parseDomain(request, reply)
    if (!domain) return reply
    const data = await store.getSyncData(userId, domain)
    return reply.code(200).send({ data })
  })

  app.put(
    '/sync/data/:domain',
    { schema: { body: SYNC_SCHEMA }, config: writeRateLimit },
    async (request, reply) => {
      const userId = await requireUser(request, reply)
      if (!userId) return reply
      const domain = parseDomain(request, reply)
      if (!domain) return reply
      const { data } = request.body as SyncBody
      // 新域数量上限（已存在域照常覆盖写）；读取仍返回 null 兼容旧客户端。
      if (
        (await store.getSyncData(userId, domain)) === null &&
        (await store.countSyncDomains(userId)) >= MAX_SYNC_DOMAINS_PER_USER
      ) {
        return reply.code(400).send({ error: 'too-many-sync-domains' })
      }
      await store.putSyncData(userId, domain, data)
      app.log.info({ audit: 'sync.put', userId, domain }, 'sync data stored')
      return reply.code(200).send({ ok: true })
    },
  )
}
