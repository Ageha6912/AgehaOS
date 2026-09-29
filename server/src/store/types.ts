export interface UserRecord {
  id: string
  username: string
  createdAt: string
  updatedAt: string
  passwordHash: string
  /** Role (ADR 20): 'admin' manages the remote catalog (§47 应用审核前置);
   *  absent = 'user'. Bootstrapped via AGEHA_ADMIN_USERNAME. */
  role?: 'user' | 'admin'
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

/** Storage cap for reported samples; the oldest records are evicted. */
export const MAX_CONTENT_SAMPLES = 500

/**
 * Content sample reported by a user for review (DDS §8.6): anonymous by
 * design (no user/session linkage) and classified by the server-side
 * classifier — `violation` text is rejected by the route and never persisted.
 */
export interface ContentSampleRecord {
  id: string
  text: string
  classification: 'ok' | 'misleading' | 'discomfort'
  createdAt: string
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
  /** Per-user sync-blob domain (PRD §35 用户配置同步 + 云文件快照); null when unset. */
  getSyncData(userId: string, domain: string): Promise<string | null>
  /** Upserts one sync domain; domain names and capacity are enforced by the route. */
  putSyncData(userId: string, domain: string, data: string): Promise<void>
  /** Admin-published remote store catalog (ADR 20); null = fall back to built-in. */
  getAppCatalog(): Promise<string | null>
  /** Replaces the published catalog (single JSON blob, validated by the route). */
  putAppCatalog(catalogJson: string): Promise<void>
  /** Stores one reported sample (DDS §8.6); keeps newest MAX_CONTENT_SAMPLES. */
  createContentSample(sample: ContentSampleRecord): Promise<void>
  /** All stored samples, newest first (admin review listing). */
  listContentSamples(): Promise<ContentSampleRecord[]>
  /** Deletes one sample by id (admin disposition); false when the id is unknown. */
  deleteContentSample(id: string): Promise<boolean>
}
