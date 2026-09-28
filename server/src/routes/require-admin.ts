import type { FastifyReply, FastifyRequest } from 'fastify'

import type { DataStore } from '../store/types'
import { SESSION_COOKIE } from './auth'

/**
 * Session + role gate shared by admin-scoped routes (remote catalog publishing,
 * content-sample review). Sends the error response itself and returns false
 * when the caller is not an authenticated admin.
 */
export async function requireAdmin(
  store: DataStore,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) {
    await reply.code(401).send({ error: 'not-authenticated' })
    return false
  }
  const session = await store.findSession(token)
  if (!session || session.expiresAt <= Date.now()) {
    await reply.code(401).send({ error: 'not-authenticated' })
    return false
  }
  const user = await store.findUserById(session.userId)
  if (!user || user.role !== 'admin') {
    await reply.code(403).send({ error: 'not-admin' })
    return false
  }
  return true
}
