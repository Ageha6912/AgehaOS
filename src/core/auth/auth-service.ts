import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

import { generateSalt, hashPassword, verifyPassword } from './password'
import { AuthError } from './types'
import type { AuthResult, ProfileInput, Session, SessionInfo, StoredUser, User } from './types'

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

  /**
   * Boot-time consistency check: localStorage is the source of truth here,
   * so this only re-validates the stored session (AuthProvider contract).
   */
  async reconcile(): Promise<User | null> {
    if (!this.getSession()) return null
    return this.getUser()
  }

  /** Local profile patch (PRD §12.1); requires a live session. */
  async updateProfile(input: ProfileInput): Promise<User> {
    const user = this.currentUserOrThrow()
    if (input.displayName !== undefined) user.displayName = input.displayName ?? undefined
    if (input.email !== undefined) user.email = input.email ?? undefined
    if (input.avatar !== undefined) user.avatar = input.avatar ?? undefined
    user.updatedAt = new Date(this.now()).toISOString()
    this.persistUsers()
    return this.toPublicUser(user)
  }

  /** Verifies the current password before re-hashing (single-device local). */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = this.currentUserOrThrow()
    const valid = await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)
    if (!valid) throw new AuthError('invalid-credentials', 'Current password is incorrect')
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError('weak-password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    user.passwordHash = await hashPassword(newPassword, user.passwordSalt)
    user.updatedAt = new Date(this.now()).toISOString()
    this.persistUsers()
  }

  /** The local model holds exactly one session — there is nothing to revoke. */
  async revokeOtherSessions(): Promise<number> {
    this.currentUserOrThrow()
    return 0
  }

  /** Local mode: the only session is this device. */
  async listSessions(): Promise<SessionInfo[]> {
    const session = this.getSession()
    if (!session) return []
    return [{ id: 'local', device: 'local', createdAt: null, current: true }]
  }

  /** Revoking a non-local id in local mode is a no-op (nothing to revoke). */
  async revokeSession(id: string): Promise<void> {
    if (id !== 'local') throw new AuthError('not-authenticated', 'Unknown session')
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
    if (user.displayName !== undefined) publicUser.displayName = user.displayName
    if (user.email !== undefined) publicUser.email = user.email
    if (user.avatar !== undefined) publicUser.avatar = user.avatar
    return publicUser
  }

  private currentUserOrThrow(): StoredUser {
    const session = this.getSession()
    if (!session) throw new AuthError('not-authenticated', 'Not signed in')
    const user = this.users.get(session.userId)
    if (!user) throw new AuthError('not-authenticated', 'Not signed in')
    return user
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
