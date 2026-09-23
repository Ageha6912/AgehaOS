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
 * Per-user settings-sync storage (PRD §35 用户配置同步)：the server is a dumb,
 * authenticated KV — the client owns merging (boot pull, debounced push,
 * whole-blob last-writer-wins).
 */
export async function syncRoutes(app: FastifyInstance, options: SyncRoutesOptions): Promise<void> {
  const { store } = options

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

  app.get('/sync/data', async (request, reply) => {
    const userId = await requireUser(request, reply)
    if (!userId) return reply
    const data = await store.getSyncData(userId)
    return reply.code(200).send({ data })
  })

  app.put(
    '/sync/data',
    { schema: { body: SYNC_SCHEMA } },
    async (request, reply) => {
      const userId = await requireUser(request, reply)
      if (!userId) return reply
      const { data } = request.body as SyncBody
      await store.putSyncData(userId, data)
      app.log.info({ audit: 'sync.put', userId }, 'sync data stored')
      return reply.code(200).send({ ok: true })
    },
  )
}
