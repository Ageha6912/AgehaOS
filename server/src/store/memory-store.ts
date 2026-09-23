import type { DataStore, SessionRecord, UserRecord } from './types'
import { UsernameTakenError } from './types'

/** In-memory store: unit tests and throwaway dev runs. */
export class MemoryDataStore implements DataStore {
  private users = new Map<string, UserRecord>()
  private sessions = new Map<string, SessionRecord>()
  private syncData = new Map<string, { data: string; updatedAt: string }>()

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

  async getSyncData(userId: string): Promise<string | null> {
    return this.syncData.get(userId)?.data ?? null
  }

  async putSyncData(userId: string, data: string): Promise<void> {
    this.syncData.set(userId, { data, updatedAt: new Date().toISOString() })
  }
}
