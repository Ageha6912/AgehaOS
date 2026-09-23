import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { DataStore, SessionRecord, UserRecord } from './types'
import { UsernameTakenError } from './types'

interface SerializedFile {
  users: UserRecord[]
  sessions: SessionRecord[]
}

/**
 * Single JSON file with atomic-rename writes: the default local dev store so
 * registered users and sessions survive server restarts. Production uses the
 * postgres store instead (single-file writes do not scale).
 */
export class FileDataStore implements DataStore {
  private users = new Map<string, UserRecord>()
  private sessions = new Map<string, SessionRecord>()
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

  /** Serializes writes so concurrent requests cannot clobber each other. */
  private persist(): Promise<void> {
    this.writing = this.writing.then(() => this.writeNow())
    return this.writing
  }

  private async writeNow(): Promise<void> {
    const payload: SerializedFile = {
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
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
