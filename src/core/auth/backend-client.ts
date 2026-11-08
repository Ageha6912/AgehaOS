import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

import type { KeyValueStorage } from './auth-service'
import type { AuthProvider, ProfileInput } from './provider'
import { AuthError } from './types'
import type { AuthErrorCode, AuthResult, Session, SessionInfo, User } from './types'

/** Non-sensitive session metadata cached locally: user profile + expiry only.
 * The session token itself never reaches JavaScript — it lives in an
 * HttpOnly cookie (PRD §30.4). */
const CACHE_KEY = 'agehaos.auth.remote.v1'

/**
 * 单次认证请求超时（E2 审查）：网络半开时 fetch 永不落地，登录界面 busy
 * 会永久锁死提交键。15s 足够慢网完成一次认证往返。
 */
export const AUTH_REQUEST_TIMEOUT_MS = 15_000

const AUTH_ERROR_CODES: readonly AuthErrorCode[] = [
  'user-exists',
  'invalid-credentials',
  'invalid-username',
  'weak-password',
  'not-authenticated',
]

const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  'user-exists': 'Username is already taken',
  'invalid-credentials': 'Incorrect username or password',
  'invalid-username': 'Username must be 3–32 letters, digits, - or _',
  'weak-password': 'Password must be at least 6 characters',
  'not-authenticated': 'Not signed in',
}

interface ApiSessionResponse {
  user: User
  expiresAt: number
}

interface CachePayload {
  user: User
  expiresAt: number
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
 * 会话失效类错误（B1 审查）：只有 not-authenticated / 裸 401 表示 Cookie
 * 会话已失效；改密时「当前密码错误」的服务端 401 带 invalid-credentials，
 * 绝不能据此登出。
 */
function isSessionInvalidError(cause: unknown): boolean {
  if (cause instanceof AuthError) return cause.code === 'not-authenticated'
  return cause instanceof Error && cause.message === 'auth-http-401'
}

export interface RemoteAuthClientOptions {
  /** Auth API base path; '' (default) = same-origin via dev proxy/reverse proxy. */
  baseUrl?: string
  fetchFn?: typeof fetch
  storage?: KeyValueStorage | null
  now?: () => number
  /** 单次请求超时（默认 AUTH_REQUEST_TIMEOUT_MS；测试可缩短）。 */
  timeoutMs?: number
  /**
   * 系统事件总线：登录/注册/登出必须与本地 AuthService 同语义地广播
   * user.login / user.logout——动态桌面、文件同步等登录钩子依赖它
   * （2026-09-26 修复：远程模式下壁纸从不生成、同步从不拉取）。
   */
  bus?: Pick<EventBus<SystemEventMap>, 'emit'>
}

/**
 * AuthProvider backed by the Milestone 5 REST API. Server errors carry
 * machine codes (`{ error: 'user-exists' }`) which map onto AuthError so
 * the login UI needs no changes; anything else (network down, 429, 5xx)
 * surfaces as a plain error and renders as the generic auth message.
 */
export class RemoteAuthClient implements AuthProvider {
  private cache: CachePayload | null
  /**
   * 会话代际（B1 审查）：logout / 会话失效 / 新的 login·register 都推进；
   * 启动期 in-flight reconcile 的结果写回前校验代际——登出后晚到的响应
   * 不得把缓存写回（"登出后又回桌面"）。
   */
  private epoch = 0

  constructor(private readonly options: RemoteAuthClientOptions = {}) {
    this.cache = this.loadCache()
  }

  private get bus(): Pick<EventBus<SystemEventMap>, 'emit'> {
    return this.options.bus ?? systemBus
  }

  async register(username: string, password: string): Promise<User> {
    const epoch = this.beginSessionAttempt()
    const body = await this.request<ApiSessionResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    // 请求期间被登出/失效：结果不得把会话写回。
    if (this.epoch !== epoch) {
      throw new AuthError('not-authenticated', ERROR_MESSAGES['not-authenticated'])
    }
    this.storeCache(body)
    // 注册即登录：与本地 AuthService 同语义广播，登录钩子（壁纸/同步）才能触发。
    this.bus.emit('user.login', { userId: body.user.id })
    return body.user
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const epoch = this.beginSessionAttempt()
    const body = await this.request<ApiSessionResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    if (this.epoch !== epoch) {
      throw new AuthError('not-authenticated', ERROR_MESSAGES['not-authenticated'])
    }
    this.storeCache(body)
    // The real token stays in the cookie; an empty token marks it "remote".
    const session: Session = { token: '', userId: body.user.id, expiresAt: body.expiresAt }
    this.bus.emit('user.login', { userId: body.user.id })
    return { user: body.user, session }
  }

  logout(): string | null {
    this.epoch += 1
    const userId = this.cache?.user.id ?? null
    this.clearCache()
    if (userId !== null) this.bus.emit('user.logout', { userId })
    void this.request<void>('/api/auth/logout', { method: 'POST' }).catch(() => {
      /* best-effort: local state is already signed out */
    })
    return userId
  }

  getSession(): Session | null {
    const cache = this.cache
    if (!cache) return null
    if (cache.expiresAt <= this.now()) {
      this.clearCache()
      return null
    }
    return { token: '', userId: cache.user.id, expiresAt: cache.expiresAt }
  }

  getUser(): User | null {
    if (!this.getSession() || !this.cache) return null
    return this.cache.user
  }

  /** Asks the server whether the cookie still names a live session. */
  async reconcile(): Promise<User | null> {
    const epoch = this.epoch
    try {
      const body = await this.request<ApiSessionResponse>('/api/auth/session', { method: 'GET' })
      // 登出/失效已发生：晚到的响应不得复活会话。
      if (this.epoch !== epoch) return null
      this.storeCache(body)
      return body.user
    } catch (cause) {
      if (this.epoch !== epoch) return null
      if (isSessionInvalidError(cause)) {
        // 服务端明确说会话没了（401/not-authenticated）：清缓存登出。
        this.clearCache()
        return null
      }
      // 网络断开/5xx/429：不能当登出（离线启动、服务端瞬时故障）——保留
      // 本地缓存（未过期）作为 fast path，恢复在线后的 reconcile 再校正。
      const cache = this.cache
      if (!cache || cache.expiresAt <= this.now()) return null
      return cache.user
    }
  }

  async updateProfile(input: ProfileInput): Promise<User> {
    const epoch = this.epoch
    const body = await this.authedRequest<{ user: User }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    // 请求期间被登出/失效：不把过期结果写回缓存。
    if (this.epoch !== epoch) {
      throw new AuthError('not-authenticated', ERROR_MESSAGES['not-authenticated'])
    }
    // Keep the local fast-path cache in sync with the server's copy.
    if (this.cache) this.storeCache({ user: body.user, expiresAt: this.cache.expiresAt })
    return body.user
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.authedRequest<null>('/api/users/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  }

  async revokeOtherSessions(): Promise<number> {
    const body = await this.authedRequest<{ revoked: number }>(
      '/api/auth/sessions/revoke-others',
      { method: 'POST' },
    )
    return body.revoked
  }

  async listSessions(): Promise<SessionInfo[]> {
    const body = await this.authedRequest<{ sessions: SessionInfo[] }>('/api/auth/sessions', {
      method: 'GET',
    })
    return body.sessions
  }

  async revokeSession(id: string): Promise<void> {
    await this.authedRequest<{ revoked: boolean }>(
      `/api/auth/sessions/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const fetchFn = this.options.fetchFn ?? fetch
    const timeoutMs = this.options.timeoutMs ?? AUTH_REQUEST_TIMEOUT_MS
    // 超时覆盖到 body 读完：半开连接既可能卡在首包，也可能卡在响应体。
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const external = init.signal ?? null
    const onExternalAbort = (): void => controller.abort()
    if (external) {
      if (external.aborted) controller.abort()
      else external.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      let response: Response
      try {
        response = await fetchFn(`${this.options.baseUrl ?? ''}${path}`, {
          ...init,
          signal: controller.signal,
          credentials: 'same-origin',
          // 只在确有请求体时声明 content-type——空 body + json content-type
          // 会被 Fastify 当成损坏的 JSON（FST_ERR_CTP_EMPTY_JSON_BODY）。
          headers:
            init.body === undefined
              ? init.headers
              : { 'content-type': 'application/json', ...init.headers },
        })
      } catch {
        throw new Error(timedOut ? 'auth-timeout' : 'auth-network-error')
      }
      const payload = (await response.json().catch(() => null)) as unknown
      if (timedOut) throw new Error('auth-timeout')
      if (!response.ok) {
        const code = (payload as { error?: unknown } | null)?.error
        if (typeof code === 'string' && AUTH_ERROR_CODES.includes(code as AuthErrorCode)) {
          throw new AuthError(code as AuthErrorCode, ERROR_MESSAGES[code as AuthErrorCode])
        }
        throw new Error(`auth-http-${response.status}`)
      }
      return payload as T
    } finally {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    }
  }

  /** 新的登录/注册尝试：推进代际（作废 in-flight reconcile），返回本次代际。 */
  private beginSessionAttempt(): number {
    this.epoch += 1
    return this.epoch
  }

  /**
   * 已认证接口的请求：401/not-authenticated = 服务端会话已失效——清缓存 +
   * 广播 user.logout（session-store 订阅后统一复位）；改密错误的 401 是
   * invalid-credentials，按业务错误原样上抛，不误登出。
   */
  private async authedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      return await this.request<T>(path, init)
    } catch (cause) {
      if (isSessionInvalidError(cause)) {
        this.invalidateSession()
        throw new AuthError('not-authenticated', ERROR_MESSAGES['not-authenticated'])
      }
      throw cause
    }
  }

  /** 服务端判定会话失效：推进代际、清缓存、广播（幂等：无缓存用户不广播）。 */
  private invalidateSession(): void {
    this.epoch += 1
    const userId = this.cache?.user.id ?? null
    this.clearCache()
    if (userId !== null) this.bus.emit('user.logout', { userId })
  }

  private storeCache(body: ApiSessionResponse): void {
    this.cache = { user: body.user, expiresAt: body.expiresAt }
    try {
      this.storage()?.setItem(CACHE_KEY, JSON.stringify(this.cache))
    } catch {
      /* quota or privacy mode: cache stays in memory */
    }
  }

  private clearCache(): void {
    this.cache = null
    try {
      this.storage()?.removeItem(CACHE_KEY)
    } catch {
      /* storage unavailable */
    }
  }

  private loadCache(): CachePayload | null {
    const storage = this.storage()
    if (!storage) return null
    let raw: string | null
    try {
      raw = storage.getItem(CACHE_KEY)
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<CachePayload>
      const user = parsed.user
      if (
        typeof parsed.expiresAt !== 'number' ||
        typeof user !== 'object' ||
        user === null ||
        typeof user.id !== 'string' ||
        typeof user.username !== 'string'
      ) {
        return null
      }
      return { user, expiresAt: parsed.expiresAt }
    } catch {
      return null
    }
  }

  private storage(): KeyValueStorage | null {
    return this.options.storage === undefined ? defaultStorage() : this.options.storage
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
