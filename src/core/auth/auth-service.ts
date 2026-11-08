import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

import { AvatarError, isValidAvatarDataUrl } from './avatar'
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
  /**
   * 内存态会话：storage 不可用（隐私模式/持久化被拒）时的唯一会话载体。
   * 有 storage 时仍以 storage 为准（跨标签页登出要能生效）；本字段只在
   * 无 storage 或 storage 读取抛错时兜底（2026-11 审查 B1：此前 storage
   * 为 null 时登录看似成功但 getSession/getUser 恒 null，资料页/改密不可用）。
   */
  private currentSession: Session | null = null

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
      const passwordHash = await hashPassword(password, salt)
      // 并发 check-then-act 复检（2026-11 审查 B1）：hash 是异步让出点，
      // 两个同名注册都可能通过第 72 行的初查——写入前同步复检，后者丢弃。
      if ([...this.users.values()].some((user) => user.username === username)) {
        throw new AuthError('user-exists', `Username "${username}" is already taken`)
      }
      const user: StoredUser = {
        id: this.generateId(),
        username,
        createdAt: timestamp,
        updatedAt: timestamp,
        passwordSalt: salt,
        passwordHash,
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
    this.currentSession = null
    try {
      this.storage?.removeItem(SESSION_KEY)
    } catch {
      /* storage unavailable: memory session is already cleared */
    }
    if (!session) return null
    this.bus.emit('user.logout', { userId: session.userId })
    return session.userId
  }

  /** The stored session if present and unexpired; expired ones are cleared. */
  getSession(): Session | null {
    const session = this.getStoredSession()
    if (!session) return null
    if (session.expiresAt <= this.now()) {
      this.currentSession = null
      try {
        this.storage?.removeItem(SESSION_KEY)
      } catch {
        /* storage unavailable */
      }
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
    if (input.avatar !== undefined) {
      // 格式白名单在本地模式同样是入库闸（PRD §8.4 / avatar.ts）：此前只
      // 在 fileToAvatarDataUrl 内部校验，程序化调用可绕过写入 svg/超限串。
      if (input.avatar !== null && !isValidAvatarDataUrl(input.avatar)) {
        throw new AvatarError('avatar-invalid')
      }
      user.avatar = input.avatar ?? undefined
    }
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
    // 内存态先落地（storage 写入失败/不可用时 getSession 仍可用）。
    this.currentSession = session
    try {
      this.storage?.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      /* quota/privacy: memory session keeps this page signed in */
    }
    return session
  }

  private getStoredSession(): Session | null {
    // 无 storage：memory 是唯一来源（隐私模式/持久化被拒环境）。
    if (!this.storage) return this.currentSession
    let raw: string | null
    try {
      raw = this.storage.getItem(SESSION_KEY)
    } catch {
      // storage 运行时读取失败（被拒/损坏）：退回内存态，不把会话判死。
      return this.currentSession
    }
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
    let raw: string | null
    try {
      raw = this.storage.getItem(USERS_KEY)
    } catch {
      return
    }
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
    } catch (cause) {
      // 静默降级仍要可观测（B1 审查：register/updateProfile 返回成功但数据
      // 只在内存——刷新即丢；console.error 是无 UI 面下的最小可诊断性）。
      console.error('[AgehaOS:auth] user persistence failed (memory only)', cause)
    }
  }
}
