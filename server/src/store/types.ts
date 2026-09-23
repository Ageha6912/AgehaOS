export interface UserRecord {
  id: string
  username: string
  createdAt: string
  updatedAt: string
  passwordHash: string
}

export interface SessionRecord {
  token: string
  userId: string
  /** Epoch milliseconds. */
  expiresAt: number
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken`)
    this.name = 'UsernameTakenError'
  }
}

/**
 * Persistence boundary for the auth service. Implementations: memory
 * (tests/dev), file (default local dev, survives restarts) and postgres
 * (production; activated by DATABASE_URL).
 */
export interface DataStore {
  init(): Promise<void>
  close(): Promise<void>
  findUserByUsername(username: string): Promise<UserRecord | null>
  findUserById(id: string): Promise<UserRecord | null>
  /** Rejects with UsernameTakenError when the username already exists. */
  createUser(user: UserRecord): Promise<void>
  createSession(session: SessionRecord): Promise<void>
  findSession(token: string): Promise<SessionRecord | null>
  deleteSession(token: string): Promise<void>
  /** Deletes sessions whose expiresAt is before `now`; returns count. */
  pruneExpiredSessions(now: number): Promise<number>
}
