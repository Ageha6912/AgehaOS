export interface UserRecord {
  id: string
  username: string
  createdAt: string
  updatedAt: string
  passwordHash: string
  /** Optional profile fields (PRD §12.1 修改昵称/资料); absent = unset. */
  displayName?: string
  email?: string
  /** Avatar as a client-resized data URL (format-whitelisted, ≤64KB chars). */
  avatar?: string
}

export interface SessionRecord {
  token: string
  userId: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** ISO creation time; sessions predating device management omit it. */
  createdAt?: string
  /** Short human-readable device label captured at login. */
  device?: string
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
  /** Persists profile/hash changes for an existing user. */
  updateUser(user: UserRecord): Promise<void>
  createSession(session: SessionRecord): Promise<void>
  findSession(token: string): Promise<SessionRecord | null>
  deleteSession(token: string): Promise<void>
  /** Deletes sessions whose expiresAt is before `now`; returns count. */
  pruneExpiredSessions(now: number): Promise<number>
  /** Revokes every session of the user except `keepToken`; returns count. */
  deleteSessionsForUserExcept(userId: string, keepToken: string): Promise<number>
  /** All live sessions of the user (device management, PRD §12.1/§35). */
  findSessionsForUser(userId: string): Promise<SessionRecord[]>
  /** Per-user settings-sync blob (PRD §35 用户配置同步); null when unset. */
  getSyncData(userId: string): Promise<string | null>
  /** Upserts the user's sync blob; capacity is enforced by the route. */
  putSyncData(userId: string, data: string): Promise<void>
}
