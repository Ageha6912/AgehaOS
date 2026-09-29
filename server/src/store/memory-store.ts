import type { ContentSampleRecord, DataStore, SessionRecord, UserRecord } from './types'
import { MAX_CONTENT_SAMPLES, UsernameTakenError } from './types'

/** In-memory store: unit tests and throwaway dev runs. */
export class MemoryDataStore implements DataStore {
  private users = new Map<string, UserRecord>()
  private sessions = new Map<string, SessionRecord>()
  private syncData = new Map<string, Map<string, { data: string; updatedAt: string }>>()
  private appCatalog: string | null = null
  private contentSamples: ContentSampleRecord[] = []

  async init(): Promise<void> {}

  async close(): Promise<void> {}

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
  }

  async updateUser(user: UserRecord): Promise<void> {
    if (!this.users.has(user.id)) throw new Error(`Unknown user ${user.id}`)
    this.users.set(user.id, user)
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.token, session)
  }

  async findSession(token: string): Promise<SessionRecord | null> {
    return this.sessions.get(token) ?? null
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token)
  }

  async pruneExpiredSessions(now: number): Promise<number> {
    let pruned = 0
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(token)
        pruned += 1
      }
    }
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
  }

  async getAppCatalog(): Promise<string | null> {
    return this.appCatalog
  }

  async putAppCatalog(catalogJson: string): Promise<void> {
    this.appCatalog = catalogJson
  }

  async createContentSample(sample: ContentSampleRecord): Promise<void> {
    this.contentSamples = [sample, ...this.contentSamples].slice(0, MAX_CONTENT_SAMPLES)
  }

  async listContentSamples(): Promise<ContentSampleRecord[]> {
    return [...this.contentSamples]
  }

  async deleteContentSample(id: string): Promise<boolean> {
    const before = this.contentSamples.length
    this.contentSamples = this.contentSamples.filter((sample) => sample.id !== id)
    return this.contentSamples.length !== before
  }
}
