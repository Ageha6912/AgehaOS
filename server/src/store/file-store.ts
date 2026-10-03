import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ContentSampleRecord, DataStore, SessionRecord, UserRecord } from './types'
import { MAX_CONTENT_SAMPLES, UsernameTakenError } from './types'

interface SyncEntry {
  data: string
  updatedAt: string
}

interface SerializedFile {
  users: UserRecord[]
  sessions: SessionRecord[]
  /** Per-user sync domains (PRD §35 用户配置同步 + 云文件快照). Legacy shape
   *  (flat `userId → SyncEntry`) is migrated to `userId → 'settings'` on load. */
  sync: Record<string, Record<string, SyncEntry>>
  /** Admin-published remote store catalog (ADR 20); absent = built-in. */
  catalog?: string
  /** Reported content samples (DDS §8.6); absent on files written before the
   *  sample-upload slice. Newest first, capped at MAX_CONTENT_SAMPLES. */
  samples?: ContentSampleRecord[]
  /** 羽化每日计数（§9.3）：day → key → value。absent on older files. */
  eclosionDaily?: Record<string, Record<string, number>>
  /** 羽化 L1 全局 HTML 缓存（§9.2）：key → html。absent on older files. */
  eclosionCache?: Record<string, string>
}

/** Distinguishes the legacy flat entry from the nested per-domain record. */
function isLegacySyncEntry(value: unknown): value is SyncEntry {
  return typeof value === 'object' && value !== null && typeof (value as SyncEntry).data === 'string'
}

/**
 * Single JSON file with atomic-rename writes: the default local dev store so
 * registered users and sessions survive server restarts. Production uses the
 * postgres store instead (single-file writes do not scale).
 */
export class FileDataStore implements DataStore {
  private users = new Map<string, UserRecord>()
  private sessions = new Map<string, SessionRecord>()
  private syncData = new Map<string, Map<string, SyncEntry>>()
  private appCatalog: string | null = null
  private contentSamples: ContentSampleRecord[] = []
  /** 羽化每日计数 + 全局缓存（§9.2/§9.3）持久化；单飞锁不持久（TTL 自愈的
   *  短命状态，重启即清零，落盘反而在崩溃后挡住恢复）。 */
  private eclosionDaily = new Map<string, Map<string, number>>()
  private eclosionCache = new Map<string, string>()
  private eclosionLocks = new Map<string, { holder: string; expiresAt: number }>()
  private writing = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return // first boot: no file yet
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SerializedFile>
      if (Array.isArray(parsed.users)) {
        for (const user of parsed.users) {
          if (isUserRecord(user)) this.users.set(user.id, user)
        }
      }
      if (Array.isArray(parsed.sessions)) {
        for (const session of parsed.sessions) {
          if (isSessionRecord(session)) this.sessions.set(session.token, session)
        }
      }
      if (typeof parsed.sync === 'object' && parsed.sync !== null) {
        for (const [userId, entry] of Object.entries(parsed.sync)) {
          // Legacy flat shape (userId → entry) migrates to the settings domain.
          if (isLegacySyncEntry(entry)) {
            this.syncData.set(userId, new Map([['settings', entry]]))
            continue
          }
          if (typeof entry !== 'object' || entry === null) continue
          const domains = new Map<string, SyncEntry>()
          for (const [domain, domainEntry] of Object.entries(entry)) {
            if (isSyncEntry(domainEntry)) domains.set(domain, domainEntry)
          }
          if (domains.size > 0) this.syncData.set(userId, domains)
        }
      }
      if (typeof parsed.catalog === 'string' && parsed.catalog.length > 0) {
        this.appCatalog = parsed.catalog
      }
      if (Array.isArray(parsed.samples)) {
        for (const sample of parsed.samples) {
          if (isContentSampleRecord(sample)) this.contentSamples.push(sample)
        }
        this.contentSamples = this.contentSamples.slice(0, MAX_CONTENT_SAMPLES)
      }
      if (typeof parsed.eclosionDaily === 'object' && parsed.eclosionDaily !== null) {
        for (const [day, entries] of Object.entries(parsed.eclosionDaily)) {
          if (typeof entries !== 'object' || entries === null) continue
          const keys = new Map<string, number>()
          for (const [key, value] of Object.entries(entries)) {
            if (typeof value === 'number' && Number.isFinite(value)) keys.set(key, value)
          }
          if (keys.size > 0) this.eclosionDaily.set(day, keys)
        }
      }
      if (typeof parsed.eclosionCache === 'object' && parsed.eclosionCache !== null) {
        for (const [key, html] of Object.entries(parsed.eclosionCache)) {
          if (typeof html === 'string') this.eclosionCache.set(key, html)
        }
      }
    } catch {
      // Corrupted file: start empty rather than crash-looping; the next
      // successful write replaces it.
    }
  }

  async close(): Promise<void> {
    await this.writing
  }

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.username === username) return user
    }
    return null
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null
  }

  async createUser(user: UserRecord): Promise<void> {
    const existing = await this.findUserByUsername(user.username)
    if (existing) throw new UsernameTakenError(user.username)
    this.users.set(user.id, user)
    await this.persist()
  }

  async updateUser(user: UserRecord): Promise<void> {
    if (!this.users.has(user.id)) throw new Error(`Unknown user ${user.id}`)
    this.users.set(user.id, user)
    await this.persist()
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.token, session)
    await this.persist()
  }

  async findSession(token: string): Promise<SessionRecord | null> {
    return this.sessions.get(token) ?? null
  }

  async deleteSession(token: string): Promise<void> {
    if (this.sessions.delete(token)) await this.persist()
  }

  async pruneExpiredSessions(now: number): Promise<number> {
    let pruned = 0
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(token)
        pruned += 1
      }
    }
    if (pruned > 0) await this.persist()
    return pruned
  }

  async deleteSessionsForUserExcept(userId: string, keepToken: string): Promise<number> {
    let revoked = 0
    for (const [token, session] of this.sessions) {
      if (session.userId === userId && token !== keepToken) {
        this.sessions.delete(token)
        revoked += 1
      }
    }
    if (revoked > 0) await this.persist()
    return revoked
  }

  async findSessionsForUser(userId: string): Promise<SessionRecord[]> {
    const sessions: SessionRecord[] = []
    for (const session of this.sessions.values()) {
      if (session.userId === userId) sessions.push(session)
    }
    return sessions
  }

  async getSyncData(userId: string, domain: string): Promise<string | null> {
    return this.syncData.get(userId)?.get(domain)?.data ?? null
  }

  async putSyncData(userId: string, domain: string, data: string): Promise<void> {
    let domains = this.syncData.get(userId)
    if (!domains) {
      domains = new Map()
      this.syncData.set(userId, domains)
    }
    domains.set(domain, { data, updatedAt: new Date().toISOString() })
    await this.persist()
  }

  async getAppCatalog(): Promise<string | null> {
    return this.appCatalog
  }

  async putAppCatalog(catalogJson: string): Promise<void> {
    this.appCatalog = catalogJson
    await this.persist()
  }

  async createContentSample(sample: ContentSampleRecord): Promise<void> {
    this.contentSamples = [sample, ...this.contentSamples].slice(0, MAX_CONTENT_SAMPLES)
    await this.persist()
  }

  async listContentSamples(): Promise<ContentSampleRecord[]> {
    return [...this.contentSamples]
  }

  async deleteContentSample(id: string): Promise<boolean> {
    const before = this.contentSamples.length
    this.contentSamples = this.contentSamples.filter((sample) => sample.id !== id)
    const deleted = this.contentSamples.length !== before
    if (deleted) await this.persist()
    return deleted
  }

  async incrementEclosionDaily(key: string, day: string, by: number): Promise<number> {
    let keys = this.eclosionDaily.get(day)
    if (!keys) {
      keys = new Map()
      this.eclosionDaily.set(day, keys)
    }
    const next = (keys.get(key) ?? 0) + by
    keys.set(key, next)
    await this.persist()
    return next
  }

  async getEclosionDaily(key: string, day: string): Promise<number> {
    return this.eclosionDaily.get(day)?.get(key) ?? 0
  }

  async getEclosionCache(key: string): Promise<string | null> {
    return this.eclosionCache.get(key) ?? null
  }

  async putEclosionCache(key: string, html: string): Promise<void> {
    this.eclosionCache.set(key, html)
    await this.persist()
  }

  async acquireEclosionLock(key: string, holder: string, ttlMs: number): Promise<boolean> {
    const existing = this.eclosionLocks.get(key)
    if (existing && existing.expiresAt > Date.now() && existing.holder !== holder) return false
    this.eclosionLocks.set(key, { holder, expiresAt: Date.now() + ttlMs })
    return true
  }

  async releaseEclosionLock(key: string, holder: string): Promise<void> {
    const existing = this.eclosionLocks.get(key)
    if (existing && existing.holder === holder) this.eclosionLocks.delete(key)
  }

  /** Serializes writes so concurrent requests cannot clobber each other. */
  private persist(): Promise<void> {
    this.writing = this.writing.then(() => this.writeNow())
    return this.writing
  }

  private async writeNow(): Promise<void> {
    const sync: Record<string, Record<string, SyncEntry>> = {}
    for (const [userId, domains] of this.syncData) {
      sync[userId] = Object.fromEntries(domains)
    }
    // 每日计数只保留最近 8 个 day（重置时间即次日零点，旧计数无用）。
    const recentDays = [...this.eclosionDaily.keys()].sort().slice(-8)
    const eclosionDaily: Record<string, Record<string, number>> = {}
    for (const day of recentDays) {
      eclosionDaily[day] = Object.fromEntries(this.eclosionDaily.get(day) as Map<string, number>)
    }
    const payload: SerializedFile = {
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
      sync,
      ...(this.appCatalog !== null ? { catalog: this.appCatalog } : {}),
      ...(this.contentSamples.length > 0 ? { samples: this.contentSamples } : {}),
      ...(Object.keys(eclosionDaily).length > 0 ? { eclosionDaily } : {}),
      ...(this.eclosionCache.size > 0 ? { eclosionCache: Object.fromEntries(this.eclosionCache) } : {}),
    }
    const tmpPath = `${this.filePath}.tmp`
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmpPath, this.filePath)
  }
}

function isUserRecord(value: unknown): value is UserRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.username === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    typeof record.passwordHash === 'string'
  )
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.token === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.expiresAt === 'number'
  )
}

function isSyncEntry(value: unknown): value is SyncEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.data === 'string' && typeof entry.updatedAt === 'string'
}

function isContentSampleRecord(value: unknown): value is ContentSampleRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.text === 'string' &&
    (record.classification === 'ok' ||
      record.classification === 'misleading' ||
      record.classification === 'discomfort') &&
    typeof record.createdAt === 'string'
  )
}
