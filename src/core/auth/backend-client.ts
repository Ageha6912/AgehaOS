import type { KeyValueStorage } from './auth-service'
import type { AuthProvider, ProfileInput } from './provider'
import { AuthError } from './types'
import type { AuthErrorCode, AuthResult, Session, SessionInfo, User } from './types'

/** Non-sensitive session metadata cached locally: user profile + expiry only.
 * The session token itself never reaches JavaScript — it lives in an
 * HttpOnly cookie (PRD §30.4). */
const CACHE_KEY = 'agehaos.auth.remote.v1'

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

export interface RemoteAuthClientOptions {
  /** Auth API base path; '' (default) = same-origin via dev proxy/reverse proxy. */
  baseUrl?: string
  fetchFn?: typeof fetch
  storage?: KeyValueStorage | null
  now?: () => number
}

/**
 * AuthProvider backed by the Milestone 5 REST API. Server errors carry
 * machine codes (`{ error: 'user-exists' }`) which map onto AuthError so
 * the login UI needs no changes; anything else (network down, 429, 5xx)
 * surfaces as a plain error and renders as the generic auth message.
 */
export class RemoteAuthClient implements AuthProvider {
  private cache: CachePayload | null

  constructor(private readonly options: RemoteAuthClientOptions = {}) {
    this.cache = this.loadCache()
  }

  async register(username: string, password: string): Promise<User> {
    const body = await this.request<ApiSessionResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    this.storeCache(body)
    return body.user
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const body = await this.request<ApiSessionResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    this.storeCache(body)
    // The real token stays in the cookie; an empty token marks it "remote".
    const session: Session = { token: '', userId: body.user.id, expiresAt: body.expiresAt }
    return { user: body.user, session }
  }

  logout(): string | null {
    const userId = this.cache?.user.id ?? null
    this.clearCache()
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
    try {
      const body = await this.request<ApiSessionResponse>('/api/auth/session', { method: 'GET' })
      this.storeCache(body)
      return body.user
    } catch {
      this.clearCache()
      return null
    }
  }

  async updateProfile(input: ProfileInput): Promise<User> {
    const body = await this.request<{ user: User }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    // Keep the local fast-path cache in sync with the server's copy.
    if (this.cache) this.storeCache({ user: body.user, expiresAt: this.cache.expiresAt })
    return body.user
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request<null>('/api/users/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  }

  async revokeOtherSessions(): Promise<number> {
    const body = await this.request<{ revoked: number }>('/api/auth/sessions/revoke-others', {
      method: 'POST',
    })
    return body.revoked
  }

  async listSessions(): Promise<SessionInfo[]> {
    const body = await this.request<{ sessions: SessionInfo[] }>('/api/auth/sessions', {
      method: 'GET',
    })
    return body.sessions
  }

  async revokeSession(id: string): Promise<void> {
    await this.request<{ revoked: boolean }>(`/api/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const fetchFn = this.options.fetchFn ?? fetch
    let response: Response
    try {
      response = await fetchFn(`${this.options.baseUrl ?? ''}${path}`, {
        ...init,
        credentials: 'same-origin',
        // 只在确有请求体时声明 content-type——空 body + json content-type
        // 会被 Fastify 当成损坏的 JSON（FST_ERR_CTP_EMPTY_JSON_BODY）。
        headers: init.body === undefined ? init.headers : { 'content-type': 'application/json', ...init.headers },
      })
    } catch {
      throw new Error('auth-network-error')
    }
    const payload = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      const code = (payload as { error?: unknown } | null)?.error
      if (typeof code === 'string' && AUTH_ERROR_CODES.includes(code as AuthErrorCode)) {
        throw new AuthError(code as AuthErrorCode, ERROR_MESSAGES[code as AuthErrorCode])
      }
      throw new Error(`auth-http-${response.status}`)
    }
    return payload as T
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
