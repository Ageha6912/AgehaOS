import type { PoolClient, QueryResult } from 'pg'

import type { DataStore, SessionRecord, UserRecord } from './types'
import { UsernameTakenError } from './types'

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
  `CREATE TABLE IF NOT EXISTS ageha_sessions (
     token TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES ageha_users(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL
   )`,
  `ALTER TABLE ageha_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`,
  `ALTER TABLE ageha_sessions ADD COLUMN IF NOT EXISTS device TEXT`,
  `CREATE INDEX IF NOT EXISTS ageha_sessions_user_id_idx ON ageha_sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS ageha_sync (
     user_id TEXT PRIMARY KEY REFERENCES ageha_users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL
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
      'SELECT id, username, created_at, updated_at, password_hash, display_name, email, avatar FROM ageha_users WHERE username = $1',
      [username],
    )
    const row = result.rows[0]
    return row ? rowToUser(row) : null
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT id, username, created_at, updated_at, password_hash, display_name, email, avatar FROM ageha_users WHERE id = $1',
      [id],
    )
    const row = result.rows[0]
    return row ? rowToUser(row) : null
  }

  async createUser(user: UserRecord): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO ageha_users (id, username, created_at, updated_at, password_hash, display_name, email, avatar) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [user.id, user.username, user.createdAt, user.updatedAt, user.passwordHash, user.displayName ?? null, user.email ?? null, user.avatar ?? null],
      )
    } catch (cause) {
      if (isPgError(cause, UNIQUE_VIOLATION)) throw new UsernameTakenError(user.username)
      throw cause
    }
  }

  async updateUser(user: UserRecord): Promise<void> {
    const result = await this.pool.query(
      'UPDATE ageha_users SET username = $2, updated_at = $3, password_hash = $4, display_name = $5, email = $6, avatar = $7 WHERE id = $1',
      [user.id, user.username, user.updatedAt, user.passwordHash, user.displayName ?? null, user.email ?? null, user.avatar ?? null],
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

  async getSyncData(userId: string): Promise<string | null> {
    const result = await this.pool.query(
      'SELECT data FROM ageha_sync WHERE user_id = $1',
      [userId],
    )
    const row = result.rows[0]
    return row ? String(row.data) : null
  }

  async putSyncData(userId: string, data: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ageha_sync (user_id, data, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = $3`,
      [userId, data, new Date().toISOString()],
    )
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

function isPgError(cause: unknown, code: string): cause is { code: string } {
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === code
}
