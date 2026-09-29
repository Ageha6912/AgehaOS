import type { PoolClient, QueryResult } from 'pg'

import type { ContentSampleRecord, DataStore, SessionRecord, UserRecord } from './types'
import { MAX_CONTENT_SAMPLES, UsernameTakenError } from './types'

/** Minimal pool surface so tests can inject a fake. */
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<QueryResult>
  connect(): Promise<PoolClient>
  end(): Promise<void>
}

const SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS ageha_users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     created_at TIMESTAMPTZ NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL,
     password_hash TEXT NOT NULL
   )`,
  `ALTER TABLE ageha_users ADD COLUMN IF NOT EXISTS display_name TEXT`,
  `ALTER TABLE ageha_users ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE ageha_users ADD COLUMN IF NOT EXISTS avatar TEXT`,
  `ALTER TABLE ageha_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`,
  `CREATE TABLE IF NOT EXISTS ageha_app_catalog (
     id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     apps JSONB NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ageha_sessions (
     token TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES ageha_users(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL
   )`,
  `ALTER TABLE ageha_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`,
  `ALTER TABLE ageha_sessions ADD COLUMN IF NOT EXISTS device TEXT`,
  `CREATE INDEX IF NOT EXISTS ageha_sessions_user_id_idx ON ageha_sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS ageha_sync (
     user_id TEXT NOT NULL REFERENCES ageha_users(id) ON DELETE CASCADE,
     domain TEXT NOT NULL DEFAULT 'settings',
     data TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL
   )`,
  // 2026-09 (云文件切片): sync storage holds one row per (user, domain) —
  // settings + files. Legacy tables carried a single-row-per-user PK; drop it
  // so extra domains fit, backfill the domain column, and enforce uniqueness
  // with an index the upsert can target.
  `ALTER TABLE ageha_sync DROP CONSTRAINT IF EXISTS ageha_sync_pkey`,
  `ALTER TABLE ageha_sync ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'settings'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ageha_sync_user_domain_idx ON ageha_sync (user_id, domain)`,
  // 2026-09 (样本上传切片, DDS §8.6): anonymous reported content samples for
  // admin review. No user reference by design (privacy minimization).
  `CREATE TABLE IF NOT EXISTS ageha_content_samples (
     id TEXT PRIMARY KEY,
     text TEXT NOT NULL,
     classification TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL
   )`,
]

const UNIQUE_VIOLATION = '23505'

/**
 * PostgreSQL store (PRD §20). Enabled with DATABASE_URL or AGEHA_STORE=postgres.
 * All statements are parameterized; the schema is created idempotently on init.
 */
export class PostgresDataStore implements DataStore {
  constructor(private readonly pool: PgPoolLike) {}

  async init(): Promise<void> {
    const client = await this.pool.connect()
    try {
      for (const statement of SCHEMA_MIGRATIONS) {
        await client.query(statement)
      }
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async findUserByUsername(username: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT id, username, created_at, updated_at, password_hash, display_name, email, avatar, role FROM ageha_users WHERE username = $1',
      [username],
    )
    const row = result.rows[0]
    return row ? rowToUser(row) : null
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT id, username, created_at, updated_at, password_hash, display_name, email, avatar, role FROM ageha_users WHERE id = $1',
      [id],
    )
    const row = result.rows[0]
    return row ? rowToUser(row) : null
  }

  async createUser(user: UserRecord): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO ageha_users (id, username, created_at, updated_at, password_hash, display_name, email, avatar, role) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [user.id, user.username, user.createdAt, user.updatedAt, user.passwordHash, user.displayName ?? null, user.email ?? null, user.avatar ?? null, user.role ?? 'user'],
      )
    } catch (cause) {
      if (isPgError(cause, UNIQUE_VIOLATION)) throw new UsernameTakenError(user.username)
      throw cause
    }
  }

  async updateUser(user: UserRecord): Promise<void> {
    const result = await this.pool.query(
      'UPDATE ageha_users SET username = $2, updated_at = $3, password_hash = $4, display_name = $5, email = $6, avatar = $7, role = $8 WHERE id = $1',
      [user.id, user.username, user.updatedAt, user.passwordHash, user.displayName ?? null, user.email ?? null, user.avatar ?? null, user.role ?? 'user'],
    )
    if ((result.rowCount ?? 0) === 0) throw new Error(`Unknown user ${user.id}`)
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO ageha_sessions (token, user_id, expires_at, created_at, device) VALUES ($1, $2, $3, $4, $5)',
      [
        session.token,
        session.userId,
        new Date(session.expiresAt).toISOString(),
        session.createdAt ?? null,
        session.device ?? null,
      ],
    )
  }

  async findSession(token: string): Promise<SessionRecord | null> {
    const result = await this.pool.query(
      'SELECT token, user_id, expires_at, created_at, device FROM ageha_sessions WHERE token = $1',
      [token],
    )
    const row = result.rows[0]
    return row ? rowToSession(row) : null
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM ageha_sessions WHERE token = $1', [token])
  }

  async pruneExpiredSessions(now: number): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM ageha_sessions WHERE expires_at < $1',
      [new Date(now).toISOString()],
    )
    return result.rowCount ?? 0
  }

  async deleteSessionsForUserExcept(userId: string, keepToken: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM ageha_sessions WHERE user_id = $1 AND token <> $2',
      [userId, keepToken],
    )
    return result.rowCount ?? 0
  }

  async findSessionsForUser(userId: string): Promise<SessionRecord[]> {
    const result = await this.pool.query(
      'SELECT token, user_id, expires_at, created_at, device FROM ageha_sessions WHERE user_id = $1',
      [userId],
    )
    return result.rows.map(rowToSession)
  }

  async getSyncData(userId: string, domain: string): Promise<string | null> {
    const result = await this.pool.query(
      'SELECT data FROM ageha_sync WHERE user_id = $1 AND domain = $2',
      [userId, domain],
    )
    const row = result.rows[0]
    return row ? String(row.data) : null
  }

  async putSyncData(userId: string, domain: string, data: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ageha_sync (user_id, domain, data, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, domain) DO UPDATE SET data = $3, updated_at = $4`,
      [userId, domain, data, new Date().toISOString()],
    )
  }

  async getAppCatalog(): Promise<string | null> {
    const result = await this.pool.query(
      'SELECT apps FROM ageha_app_catalog WHERE id = 1',
    )
    const row = result.rows[0]
    return row ? JSON.stringify(row.apps) : null
  }

  async putAppCatalog(catalogJson: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ageha_app_catalog (id, apps, updated_at) VALUES (1, $1::jsonb, $2)
       ON CONFLICT (id) DO UPDATE SET apps = $1::jsonb, updated_at = $2`,
      [catalogJson, new Date().toISOString()],
    )
  }

  async createContentSample(sample: ContentSampleRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO ageha_content_samples (id, text, classification, created_at) VALUES ($1, $2, $3, $4)',
      [sample.id, sample.text, sample.classification, sample.createdAt],
    )
    await this.pool.query(
      `DELETE FROM ageha_content_samples
       WHERE id IN (
         SELECT id FROM ageha_content_samples ORDER BY created_at DESC, id OFFSET $1
       )`,
      [MAX_CONTENT_SAMPLES],
    )
  }

  async listContentSamples(): Promise<ContentSampleRecord[]> {
    const result = await this.pool.query(
      'SELECT id, text, classification, created_at FROM ageha_content_samples ORDER BY created_at DESC, id',
    )
    return result.rows.map(rowToContentSample)
  }

  async deleteContentSample(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM ageha_content_samples WHERE id = $1', [id])
    return (result.rowCount ?? 0) > 0
  }
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  const user: UserRecord = {
    id: String(row.id),
    username: String(row.username),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    passwordHash: String(row.password_hash),
  }
  if (row.display_name !== null && row.display_name !== undefined) {
    user.displayName = String(row.display_name)
  }
  if (row.email !== null && row.email !== undefined) {
    user.email = String(row.email)
  }
  if (row.avatar !== null && row.avatar !== undefined) {
    user.avatar = String(row.avatar)
  }
  if (row.role === 'admin') {
    user.role = 'admin'
  }
  return user
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  const session: SessionRecord = {
    token: String(row.token),
    userId: String(row.user_id),
    expiresAt: new Date(row.expires_at as string).getTime(),
  }
  if (row.created_at !== null && row.created_at !== undefined) {
    session.createdAt = new Date(row.created_at as string).toISOString()
  }
  if (row.device !== null && row.device !== undefined) {
    session.device = String(row.device)
  }
  return session
}

function rowToContentSample(row: Record<string, unknown>): ContentSampleRecord {
  return {
    id: String(row.id),
    text: String(row.text),
    classification: String(row.classification) as ContentSampleRecord['classification'],
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

function isPgError(cause: unknown, code: string): cause is { code: string } {
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === code
}
