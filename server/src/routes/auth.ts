import { randomBytes } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { hashPassword, verifyPassword } from '../password'
import { generateSessionToken, generateUserId } from '../tokens'
import { UsernameTakenError } from '../store/types'
import type { DataStore, SessionRecord, UserRecord } from '../store/types'

export const SESSION_COOKIE = 'agehaos_session'

export interface RateLimitOptions {
  loginMax: number
  registerMax: number
  windowMs: number
}

export interface AuthRoutesOptions {
  store: DataStore
  sessionTtlMs: number
  cookieSecure: boolean
  rateLimit: RateLimitOptions
}

interface CredentialsBody {
  username: string
  password: string
}

const credentialsSchema = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-zA-Z0-9_-]+$' },
    password: { type: 'string', minLength: 6, maxLength: 128 },
  },
}

function publicUser(user: UserRecord): Pick<UserRecord, 'id' | 'username' | 'createdAt' | 'updatedAt'> {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

function cookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
  } as const
}

/**
 * Precomputed hash so logins for nonexistent users still pay the scrypt cost
 * (account-enumeration timing defense).
 */
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHashPromise
}

async function resolveSession(
  store: DataStore,
  request: FastifyRequest,
  reply: FastifyReply,
  cookieSecure: boolean,
): Promise<{ user: UserRecord; session: SessionRecord } | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null
  const session = await store.findSession(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (session) await store.deleteSession(token)
    reply.clearCookie(SESSION_COOKIE, cookieOptions(cookieSecure))
    return null
  }
  const user = await store.findUserById(session.userId)
  if (!user) {
    await store.deleteSession(token)
    return null
  }
  return { user, session }
}

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { store, sessionTtlMs, cookieSecure, rateLimit } = options

  app.post(
    '/auth/register',
    {
      schema: { body: credentialsSchema },
      config: { rateLimit: { max: rateLimit.registerMax, timeWindow: rateLimit.windowMs } },
    },
    async (request, reply) => {
      const { username, password } = request.body as CredentialsBody
      const now = new Date().toISOString()
      const user: UserRecord = {
        id: generateUserId(),
        username,
        createdAt: now,
        updatedAt: now,
        passwordHash: await hashPassword(password),
      }
      try {
        await store.createUser(user)
      } catch (cause) {
        if (cause instanceof UsernameTakenError) {
          return reply.code(409).send({ error: 'user-exists' })
        }
        throw cause
      }
      const expiresAt = Date.now() + sessionTtlMs
      const session: SessionRecord = {
        token: generateSessionToken(),
        userId: user.id,
        expiresAt,
      }
      await store.createSession(session)
      reply.setCookie(SESSION_COOKIE, session.token, {
        ...cookieOptions(cookieSecure),
        maxAge: Math.floor(sessionTtlMs / 1000),
      })
      app.log.info({ audit: 'auth.register', userId: user.id }, 'user registered')
      return reply.code(201).send({ user: publicUser(user), expiresAt })
    },
  )

  app.post(
    '/auth/login',
    {
      schema: { body: credentialsSchema },
      config: { rateLimit: { max: rateLimit.loginMax, timeWindow: rateLimit.windowMs } },
    },
    async (request, reply) => {
      const { username, password } = request.body as CredentialsBody
      const user = await store.findUserByUsername(username)
      let valid = false
      if (user) {
        valid = await verifyPassword(password, user.passwordHash)
      } else {
        // Equalize timing with the found-user path before rejecting.
        await verifyPassword(password, await dummyHash())
      }
      if (!user || !valid) {
        app.log.info({ audit: 'auth.login_failed' }, 'login failed')
        return reply.code(401).send({ error: 'invalid-credentials' })
      }
      await store.pruneExpiredSessions(Date.now())
      const expiresAt = Date.now() + sessionTtlMs
      const session: SessionRecord = {
        token: generateSessionToken(),
        userId: user.id,
        expiresAt,
      }
      await store.createSession(session)
      reply.setCookie(SESSION_COOKIE, session.token, {
        ...cookieOptions(cookieSecure),
        maxAge: Math.floor(sessionTtlMs / 1000),
      })
      app.log.info({ audit: 'auth.login', userId: user.id }, 'user logged in')
      return reply.code(200).send({ user: publicUser(user), expiresAt })
    },
  )

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await store.deleteSession(token)
    reply.clearCookie(SESSION_COOKIE, cookieOptions(cookieSecure))
    app.log.info({ audit: 'auth.logout' }, 'user logged out')
    return reply.code(204).send()
  })

  const sessionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const resolved = await resolveSession(store, request, reply, cookieSecure)
    if (!resolved) {
      return reply.code(401).send({ error: 'not-authenticated' })
    }
    return reply.code(200).send({ user: publicUser(resolved.user), expiresAt: resolved.session.expiresAt })
  }

  app.get('/auth/session', sessionHandler)
  app.get('/users/me', sessionHandler)
}
