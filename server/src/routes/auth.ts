import { randomBytes } from 'node:crypto'

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { hashPassword, verifyPassword } from '../password'
import { generateSessionToken, generateUserId, sessionIdOf } from '../tokens'
import { describeUserAgent } from '../useragent'
import { UsernameTakenError } from '../store/types'
import type { DataStore, SessionRecord, UserRecord } from '../store/types'

export interface PublicSession {
  id: string
  device: string
  createdAt: string | null
  expiresAt: number
  current: boolean
}

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

const profileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: ['string', 'null'], minLength: 1, maxLength: 32 },
    email: { type: ['string', 'null'], minLength: 3, maxLength: 254 },
    avatar: { type: ['string', 'null'], maxLength: 65536 },
  },
}

const passwordChangeSchema = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', minLength: 6, maxLength: 128 },
    newPassword: { type: 'string', minLength: 6, maxLength: 128 },
  },
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** §8.4 格式白名单：只接受客户端缩放后的 png/jpeg/webp data URL。 */
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

type PublicUser = Pick<UserRecord, 'id' | 'username' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<UserRecord, 'displayName' | 'email' | 'avatar'>>

function publicUser(user: UserRecord): PublicUser {
  const result: PublicUser = {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
  if (user.displayName !== undefined) result.displayName = user.displayName
  if (user.email !== undefined) result.email = user.email
  if (user.avatar !== undefined) result.avatar = user.avatar
  return result
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
        createdAt: new Date().toISOString(),
        device: describeUserAgent(request.headers['user-agent']),
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
        createdAt: new Date().toISOString(),
        device: describeUserAgent(request.headers['user-agent']),
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

  app.patch(
    '/users/me',
    { schema: { body: profileSchema } },
    async (request, reply) => {
      const resolved = await resolveSession(store, request, reply, cookieSecure)
      if (!resolved) {
        return reply.code(401).send({ error: 'not-authenticated' })
      }
      const body = request.body as {
        displayName?: string | null
        email?: string | null
        avatar?: string | null
      }
      if (body.email !== undefined && body.email !== null && !EMAIL_PATTERN.test(body.email)) {
        return reply.code(400).send({ error: 'invalid-body' })
      }
      if (body.avatar !== undefined && body.avatar !== null && !AVATAR_PATTERN.test(body.avatar)) {
        return reply.code(400).send({ error: 'invalid-body' })
      }
      const user = resolved.user
      // Absent = unchanged; explicit null = clear the field (PRD §12.1).
      if (body.displayName !== undefined) user.displayName = body.displayName ?? undefined
      if (body.email !== undefined) user.email = body.email ?? undefined
      if (body.avatar !== undefined) user.avatar = body.avatar ?? undefined
      user.updatedAt = new Date().toISOString()
      await store.updateUser(user)
      app.log.info({ audit: 'auth.profile_updated', userId: user.id }, 'profile updated')
      return reply.code(200).send({ user: publicUser(user) })
    },
  )

  app.post(
    '/users/me/password',
    {
      schema: { body: passwordChangeSchema },
      config: { rateLimit: { max: rateLimit.loginMax, timeWindow: rateLimit.windowMs } },
    },
    async (request, reply) => {
      const resolved = await resolveSession(store, request, reply, cookieSecure)
      if (!resolved) {
        return reply.code(401).send({ error: 'not-authenticated' })
      }
      const { currentPassword, newPassword } = request.body as {
        currentPassword: string
        newPassword: string
      }
      const user = resolved.user
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        app.log.info({ audit: 'auth.password_change_failed', userId: user.id }, 'password change failed')
        return reply.code(401).send({ error: 'invalid-credentials' })
      }
      user.passwordHash = await hashPassword(newPassword)
      user.updatedAt = new Date().toISOString()
      await store.updateUser(user)
      // A password change must not leave other devices signed in.
      const revoked = await store.deleteSessionsForUserExcept(user.id, resolved.session.token)
      app.log.info({ audit: 'auth.password_changed', userId: user.id, revoked }, 'password changed')
      return reply.code(204).send()
    },
  )

  app.post('/auth/sessions/revoke-others', async (request, reply) => {
    const resolved = await resolveSession(store, request, reply, cookieSecure)
    if (!resolved) {
      return reply.code(401).send({ error: 'not-authenticated' })
    }
    const revoked = await store.deleteSessionsForUserExcept(resolved.user.id, resolved.session.token)
    app.log.info(
      { audit: 'auth.sessions_revoked', userId: resolved.user.id, revoked },
      'other sessions revoked',
    )
    return reply.code(200).send({ revoked })
  })

  // Device management (PRD §12.1/§35): list own sessions; the token itself is
  // never returned — each row carries a short hash id instead.
  app.get('/auth/sessions', async (request, reply) => {
    const resolved = await resolveSession(store, request, reply, cookieSecure)
    if (!resolved) {
      return reply.code(401).send({ error: 'not-authenticated' })
    }
    const sessions = await store.findSessionsForUser(resolved.user.id)
    const live = sessions.filter((session) => session.expiresAt > Date.now())
    const rows: PublicSession[] = live
      .map((session) => ({
        id: sessionIdOf(session.token),
        device: session.device ?? 'Unknown device',
        createdAt: session.createdAt ?? null,
        expiresAt: session.expiresAt,
        current: session.token === resolved.session.token,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    return reply.code(200).send({ sessions: rows })
  })

  app.delete('/auth/sessions/:id', async (request, reply) => {
    const resolved = await resolveSession(store, request, reply, cookieSecure)
    if (!resolved) {
      return reply.code(401).send({ error: 'not-authenticated' })
    }
    const { id } = request.params as { id: string }
    const sessions = await store.findSessionsForUser(resolved.user.id)
    const target = sessions.find((session) => sessionIdOf(session.token) === id)
    if (!target) return reply.code(404).send({ error: 'not-found' })
    await store.deleteSession(target.token)
    app.log.info(
      { audit: 'auth.session_revoked', userId: resolved.user.id },
      'session revoked by device management',
    )
    return reply.code(200).send({ revoked: true })
  })
}
