import type { FastifyInstance } from 'fastify'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface OriginCheckOptions {
  allowedOrigins?: readonly string[]
}

/**
 * CSRF defense in depth (PRD §30.4): browsers always send `Origin` on
 * mutating requests, so any present-but-foreign origin is rejected. Requests
 * without an Origin header (curl, server-to-server) pass — the cookie's
 * SameSite=Lax remains the primary guard. Same-host origins and the
 * configured allowlist are accepted.
 */
export async function originCheck(
  app: FastifyInstance,
  options: OriginCheckOptions = {},
): Promise<void> {
  const allowed = new Set(options.allowedOrigins ?? [])
  app.addHook('onRequest', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return
    const origin = request.headers.origin
    if (!origin) return
    const host = request.headers.host
    let originHost: string | null
    try {
      originHost = new URL(origin).host
    } catch {
      // Malformed Origin header: treat as foreign.
      return await reply.code(403).send({ error: 'forbidden' })
    }
    if ((host !== undefined && originHost === host) || allowed.has(origin)) return
    await reply.code(403).send({ error: 'forbidden' })
  })
}
