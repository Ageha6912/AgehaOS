import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

import { generateSalt, hashPassword, verifyPassword } from './password'
import { AuthError } from './types'
import type { AuthResult, Session, StoredUser, User } from './types'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const USERS_KEY = 'agehaos.users.v1'
const SESSION_KEY = 'agehaos.session.v1'
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/
const MIN_PASSWORD_LENGTH = 6
const DAY_MS = 24 * 60 * 60 * 1000

export interface AuthOptions {
  bus?: Pick<EventBus<SystemEventMap>, 'emit'>
  /** Defaults to localStorage; inject a fake in tests or disable with `null`. */
  storage?: KeyValueStorage | null
  sessionTtlMs?: number
  generateId?: () => string
  now?: () => number
}

function defaultStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* storage access denied */
  }
  return null
}

/**
 * Local account system for v0.1 (PRD §12): registration, login, logout and
 * expiring sessions, all backed by localStorage. Passwords are stored as
 * salted SHA-256 hashes, never in plaintext. The backend (Milestone 5)
 * replaces the storage layer without changing this API.
 */
export class AuthService {
  private users = new Map<string, StoredUser>()
  private storage: KeyValueStorage | null
  private bus: Pick<EventBus<SystemEventMap>, 'emit'>
  private sessionTtlMs: number
  private generateId: () => string
  private now: () => number

  constructor(options: AuthOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
    this.bus = options.bus ?? systemBus
    this.sessionTtlMs = options.sessionTtlMs ?? 7 * DAY_MS
    this.generateId = options.generateId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => Date.now())
    this.loadUsers()
  }

  register(username: string, password: string): Promise<User> {
    return (async () => {
      if (!USERNAME_PATTERN.test(username)) {
        throw new AuthError('invalid-username', 'Username must be 3–32 letters, digits, - or _')
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new AuthError(
          'weak-password',
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        )
      }
      if ([...this.users.values()].some((user) => user.username === username)) {
        throw new AuthError('user-exists', `Username "${username}" is already taken`)
      }

      const salt = generateSalt()
      const timestamp = new Date(this.now()).toISOString()
      const user: StoredUser = {
        id: this.generateId(),
        username,
        createdAt: timestamp,
        updatedAt: timestamp,
        passwordSalt: salt,
        passwordHash: await hashPassword(password, salt),
      }
      this.users.set(user.id, user)
      this.persistUsers()
      return this.toPublicUser(user)
    })()
  }

  login(username: string, password: string): Promise<AuthResult> {
    return (async () => {
      const user = [...this.users.values()].find((candidate) => candidate.username === username)
      if (!user) throw new AuthError('invalid-credentials', 'Incorrect username or password')
      const valid = await verifyPassword(password, user.passwordSalt, user.passwordHash)
      if (!valid) throw new AuthError('invalid-credentials', 'Incorrect username or password')

      const session = this.createSession(user)
      this.bus.emit('user.login', { userId: user.id })
      return { user: this.toPublicUser(user), session }
    })()
  }

  /** Clears the current session; returns the signed-out user id, if any. */
  logout(): string | null {
    const session = this.getStoredSession()
    if (this.storage) this.storage.removeItem(SESSION_KEY)
    if (!session) return null
    this.bus.emit('user.logout', { userId: session.userId })
    return session.userId
  }

  /** The stored session if present and unexpired; expired ones are cleared. */
  getSession(): Session | null {
    const session = this.getStoredSession()
    if (!session) return null
    if (session.expiresAt <= this.now()) {
      if (this.storage) this.storage.removeItem(SESSION_KEY)
      return null
    }
    return session
  }

  getUser(): User | null {
    const session = this.getSession()
    if (!session) return null
    const user = this.users.get(session.userId)
    return user ? this.toPublicUser(user) : null
  }

  // ---- internals ----------------------------------------------------------

  private createSession(user: StoredUser): Session {
    const session: Session = {
      token: this.generateId(),
      userId: user.id,
      expiresAt: this.now() + this.sessionTtlMs,
    }
    if (this.storage) this.storage.setItem(SESSION_KEY, JSON.stringify(session))
    return session
  }

  private getStoredSession(): Session | null {
    if (!this.storage) return null
    const raw = this.storage.getItem(SESSION_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Session
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.token !== 'string' ||
        typeof parsed.userId !== 'string' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  private toPublicUser(user: StoredUser): User {
    const publicUser: User = {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
    return publicUser
  }

  private loadUsers(): void {
    if (!this.storage) return
    const raw = this.storage.getItem(USERS_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as StoredUser[]
      if (!Array.isArray(parsed)) return
      for (const user of parsed) {
        if (typeof user?.id === 'string' && typeof user?.username === 'string') {
          this.users.set(user.id, user)
        }
      }
    } catch {
      /* corrupted state: start with no users */
    }
  }

  private persistUsers(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(USERS_KEY, JSON.stringify([...this.users.values()]))
    } catch {
      /* quota or privacy mode: users stay in memory */
    }
  }
}

/** Process-level auth service backed by localStorage. */
export const systemAuthService = new AuthService()
