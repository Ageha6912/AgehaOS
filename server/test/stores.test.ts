import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileDataStore } from '../src/store/file-store'
import { MemoryDataStore } from '../src/store/memory-store'
import { PostgresDataStore } from '../src/store/postgres-store'
import type { PgPoolLike } from '../src/store/postgres-store'
import { UsernameTakenError } from '../src/store/types'
import { MAX_CONTENT_SAMPLES } from '../src/store/types'
import type { DataStore, UserRecord } from '../src/store/types'

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u1',
    username: 'alice',
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    passwordHash: 'scrypt$32768$8$1$c2FsdA$aGFzaA',
    ...overrides,
  }
}

async function expectStoreBehavior(store: DataStore): Promise<void> {
  await store.init()
  await store.createUser(makeUser())
  await expect(store.createUser(makeUser())).rejects.toBeInstanceOf(UsernameTakenError)

  const byName = await store.findUserByUsername('alice')
  expect(byName?.id).toBe('u1')
  expect(await store.findUserByUsername('ghost')).toBeNull()
  expect((await store.findUserById('u1'))?.username).toBe('alice')
  expect(await store.findUserById('nope')).toBeNull()

  await store.createSession({ token: 'tok-1', userId: 'u1', expiresAt: 2000 })
  expect((await store.findSession('tok-1'))?.userId).toBe('u1')
  expect(await store.findSession('nope')).toBeNull()

  expect(await store.pruneExpiredSessions(3000)).toBe(1)
  expect(await store.findSession('tok-1')).toBeNull()

  await store.createSession({ token: 'tok-2', userId: 'u1', expiresAt: 5000 })
  await store.deleteSession('tok-2')
  expect(await store.findSession('tok-2')).toBeNull()

  await store.createSession({ token: 'tok-3', userId: 'u1', expiresAt: 6000 })
  await store.createSession({ token: 'tok-4', userId: 'u1', expiresAt: 7000 })
  expect(await store.deleteSessionsForUserExcept('u1', 'tok-4')).toBe(1)
  expect(await store.findSession('tok-3')).toBeNull()
  expect(await store.findSession('tok-4')).not.toBeNull()

  const updated = makeUser({ displayName: 'Alice Liddell', email: 'alice@example.com', avatar: 'data:image/jpeg;base64,QUJD' })
  await store.updateUser(updated)
  expect((await store.findUserById('u1'))?.displayName).toBe('Alice Liddell')
  expect((await store.findUserByUsername('alice'))?.email).toBe('alice@example.com')
  expect((await store.findUserById('u1'))?.avatar).toBe('data:image/jpeg;base64,QUJD')

  await store.createSession({ token: 'tok-3', userId: 'u1', expiresAt: 6000 })
  await store.createSession({ token: 'tok-4', userId: 'u1', expiresAt: 7000 })
  const own = await store.findSessionsForUser('u1')
  expect(own.map((session) => session.token).sort()).toEqual(['tok-3', 'tok-4'])

  await store.putSyncData('u1', 'settings', '{"settings":{"theme":"dark"}}')
  expect(await store.getSyncData('u1', 'settings')).toBe('{"settings":{"theme":"dark"}}')
  // 云文件切片：多域互不覆盖。
  await store.putSyncData('u1', 'files', '{"version":1,"savedAt":1,"tree":{"dirs":[],"files":[]}}')
  expect(await store.getSyncData('u1', 'settings')).toBe('{"settings":{"theme":"dark"}}')
  expect(await store.getSyncData('u1', 'files')).toBe('{"version":1,"savedAt":1,"tree":{"dirs":[],"files":[]}}')
  expect(await store.getSyncData('u1', 'missing')).toBeNull()
  await store.putSyncData('u1', 'settings', '{"settings":{"theme":"light"}}')
  expect(await store.getSyncData('u1', 'files')).toBe('{"version":1,"savedAt":1,"tree":{"dirs":[],"files":[]}}')

  // ADR 20：管理员发布目录的存储往返（缺省为空）。
  expect(await store.getAppCatalog()).toBeNull()
  await store.putAppCatalog('[{"id":"com.example.app"}]')
  expect(await store.getAppCatalog()).toBe('[{"id":"com.example.app"}]')
  await store.putAppCatalog('[]')
  expect(await store.getAppCatalog()).toBe('[]')

  // 样本上传切片（DDS §8.6）：样本往返 + 新样本在前。
  expect(await store.listContentSamples()).toEqual([])
  await store.createContentSample({
    id: 's1',
    text: '较早的样本',
    classification: 'ok',
    createdAt: '2026-09-28T00:00:01.000Z',
  })
  await store.createContentSample({
    id: 's2',
    text: '较晚的样本',
    classification: 'misleading',
    createdAt: '2026-09-28T00:00:02.000Z',
  })
  const samples = await store.listContentSamples()
  expect(samples.map((sample) => sample.id)).toEqual(['s2', 's1'])
  // 复审处置：删除已复核样本；未知 id 返回 false。
  expect(await store.deleteContentSample('s2')).toBe(true)
  expect((await store.listContentSamples()).map((sample) => sample.id)).toEqual(['s1'])
  expect(await store.deleteContentSample('ghost')).toBe(false)

  await store.close()
}

describe('MemoryDataStore', () => {
  it('supports the full DataStore contract', async () => {
    await expectStoreBehavior(new MemoryDataStore())
  })
})

describe('FileDataStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'agehaos-file-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('supports the full DataStore contract', async () => {
    await expectStoreBehavior(new FileDataStore(path.join(dir, 'auth.json')))
  })

  it('persists users and sessions across instances', async () => {
    const filePath = path.join(dir, 'auth.json')
    const first = new FileDataStore(filePath)
    await first.init()
    await first.createUser(makeUser({ id: 'u1' }))
    await first.createSession({ token: 'tok', userId: 'u1', expiresAt: 9999 })
    await first.close()

    const second = new FileDataStore(filePath)
    await second.init()
    expect((await second.findUserByUsername('alice'))?.id).toBe('u1')
    expect((await second.findSession('tok'))?.userId).toBe('u1')
    await second.close()

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { users: unknown[] }
    expect(raw.users).toHaveLength(1)
  })

  it('persists content samples across instances (样本上传切片)', async () => {
    const filePath = path.join(dir, 'auth.json')
    const first = new FileDataStore(filePath)
    await first.init()
    await first.createContentSample({
      id: 's1',
      text: '重启后仍在',
      classification: 'discomfort',
      createdAt: '2026-09-28T00:00:00.000Z',
    })
    await first.createContentSample({
      id: 's2',
      text: '复审后删除',
      classification: 'ok',
      createdAt: '2026-09-28T00:00:01.000Z',
    })
    await first.close()

    const second = new FileDataStore(filePath)
    await second.init()
    expect((await second.listContentSamples()).map((sample) => sample.id)).toEqual(['s2', 's1'])
    // 删除持久化：第三个实例确认 s2 已消失。
    expect(await second.deleteContentSample('s2')).toBe(true)
    await second.close()

    const third = new FileDataStore(filePath)
    await third.init()
    expect((await third.listContentSamples()).map((sample) => sample.id)).toEqual(['s1'])
    await third.close()
  })

  it('starts empty on a corrupted file', async () => {
    const filePath = path.join(dir, 'auth.json')
    await writeFile(filePath, '{not json', 'utf8')
    const store = new FileDataStore(filePath)
    await store.init()
    expect(await store.findUserByUsername('alice')).toBeNull()
    await store.close()
  })

  it('skips malformed records when loading', async () => {
    const filePath = path.join(dir, 'auth.json')
    await writeFile(
      filePath,
      JSON.stringify({ users: [{ id: 'bad' }], sessions: [{ token: 'bad' }] }),
      'utf8',
    )
    const store = new FileDataStore(filePath)
    await store.init()
    expect(await store.findUserById('bad')).toBeNull()
    expect(await store.findSession('bad')).toBeNull()
    await store.close()
  })

  it('migrates the legacy flat sync blob into the settings domain (云文件切片)', async () => {
    const filePath = path.join(dir, 'auth.json')
    await writeFile(
      filePath,
      JSON.stringify({
        users: [],
        sessions: [],
        sync: { u1: { data: '{"settings":{"theme":"dark"}}', updatedAt: '2026-09-23T00:00:00.000Z' } },
      }),
      'utf8',
    )
    const store = new FileDataStore(filePath)
    await store.init()
    expect(await store.getSyncData('u1', 'settings')).toBe('{"settings":{"theme":"dark"}}')
    expect(await store.getSyncData('u1', 'files')).toBeNull()

    // 写入 files 域后落盘为新嵌套形状，旧 settings 数据保留。
    await store.putSyncData('u1', 'files', '{"version":1,"savedAt":1,"tree":{"dirs":[],"files":[]}}')
    await store.close()

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
      sync: Record<string, Record<string, { data: string }>>
    }
    expect(raw.sync.u1?.settings?.data).toBe('{"settings":{"theme":"dark"}}')
    expect(raw.sync.u1?.files?.data).toContain('"savedAt":1')

    const reopened = new FileDataStore(filePath)
    await reopened.init()
    expect(await reopened.getSyncData('u1', 'settings')).toBe('{"settings":{"theme":"dark"}}')
    expect(await reopened.getSyncData('u1', 'files')).toContain('"savedAt":1')
    await reopened.close()
  })
})

interface RecordedQuery {
  text: string
  values: unknown[]
}

interface FakePoolOptions {
  rows?: Record<string, unknown>[]
  rowCount?: number
  /** When set, the next query rejects with a pg-style error carrying this code. */
  errorCode?: string
}

function makeFakePool(options: FakePoolOptions = {}): PgPoolLike & {
  queries: RecordedQuery[]
  readonly ended: boolean
} {
  const queries: RecordedQuery[] = []
  let ended = false
  const result = {
    rows: options.rows ?? [],
    rowCount: options.rowCount ?? options.rows?.length ?? 0,
    command: '',
    oid: 0,
    fields: [],
  }
  const run = async (text: string, values: unknown[] = []) => {
    queries.push({ text, values })
    if (options.errorCode) throw { code: options.errorCode }
    return { ...result, rows: [...result.rows] }
  }
  return {
    queries,
    get ended() {
      return ended
    },
    query: run,
    connect: async () => ({ query: run, release: () => {} }) as never,
    end: async () => {
      ended = true
    },
  }
}

describe('PostgresDataStore', () => {
  it('creates the schema idempotently on init and ends the pool on close', async () => {
    const pool = makeFakePool()
    const store = new PostgresDataStore(pool)
    await store.init()
    const initTexts = pool.queries.map((query) => query.text)
    expect(initTexts).toHaveLength(15)
    expect(
      initTexts.every(
        (text) =>
          text.includes('CREATE TABLE IF NOT EXISTS') ||
          text.includes('CREATE INDEX IF NOT EXISTS') ||
          text.includes('CREATE UNIQUE INDEX IF NOT EXISTS') ||
          text.includes('ADD COLUMN IF NOT EXISTS') ||
          text.includes('DROP CONSTRAINT IF EXISTS'),
      ),
    ).toBe(true)
    // 云文件切片：sync 表按 (user_id, domain) 分域。
    expect(initTexts.some((text) => text.includes('ageha_sync_user_domain_idx'))).toBe(true)
    // ADR 20：用户角色列 + 管理员发布目录表。
    expect(initTexts.some((text) => text.includes("ADD COLUMN IF NOT EXISTS role"))).toBe(true)
    expect(initTexts.some((text) => text.includes('ageha_app_catalog'))).toBe(true)
    // 样本上传切片（DDS §8.6）：匿名样本复审表。
    expect(initTexts.some((text) => text.includes('ageha_content_samples'))).toBe(true)
    await store.close()
    expect(pool.ended).toBe(true)
  })

  it('binds parameters for user and session writes', async () => {
    const pool = makeFakePool({ rowCount: 1 })
    const store = new PostgresDataStore(pool)

    await store.createUser(makeUser())
    expect(pool.queries[0]?.text).toContain('INSERT INTO ageha_users')
    expect(pool.queries[0]?.values).toEqual([
      'u1',
      'alice',
      '2026-09-23T00:00:00.000Z',
      '2026-09-23T00:00:00.000Z',
      'scrypt$32768$8$1$c2FsdA$aGFzaA',
      null,
      null,
      null,
      'user',
    ])

    await store.findUserByUsername('alice')
    expect(pool.queries[1]?.values).toEqual(['alice'])

    await store.findUserById('u1')
    expect(pool.queries[2]?.values).toEqual(['u1'])

    await store.createSession({ token: 'tok', userId: 'u1', expiresAt: 1234567890123, createdAt: '2026-09-23T00:00:00.000Z', device: 'Chrome · Windows' })
    expect(pool.queries[3]?.text).toContain('INSERT INTO ageha_sessions')
    expect(pool.queries[3]?.values).toEqual([
      'tok',
      'u1',
      new Date(1234567890123).toISOString(),
      '2026-09-23T00:00:00.000Z',
      'Chrome · Windows',
    ])

    await store.findSession('tok')
    expect(pool.queries[4]?.values).toEqual(['tok'])

    await store.deleteSession('tok')
    expect(pool.queries[5]?.text).toContain('DELETE FROM ageha_sessions')
    expect(pool.queries[5]?.values).toEqual(['tok'])

    await store.pruneExpiredSessions(1000)
    expect(pool.queries[6]?.values).toEqual([new Date(1000).toISOString()])

    await store.deleteSessionsForUserExcept('u1', 'tok')
    expect(pool.queries[7]?.text).toContain('DELETE FROM ageha_sessions WHERE user_id')
    expect(pool.queries[7]?.values).toEqual(['u1', 'tok'])

    await store.updateUser(
      makeUser({ displayName: 'Alice', email: 'a@example.com', avatar: 'data:image/png;base64,QUJD' }),
    )
    expect(pool.queries[8]?.text).toContain('UPDATE ageha_users')
    expect(pool.queries[8]?.text).toContain('role = $8')
    expect(pool.queries[8]?.values).toEqual([
      'u1',
      'alice',
      '2026-09-23T00:00:00.000Z',
      'scrypt$32768$8$1$c2FsdA$aGFzaA',
      'Alice',
      'a@example.com',
      'data:image/png;base64,QUJD',
      'user',
    ])

    await store.findSessionsForUser('u1')
    expect(pool.queries[9]?.text).toContain('WHERE user_id = $1')
    expect(pool.queries[9]?.values).toEqual(['u1'])

    await store.getSyncData('u1', 'files')
    expect(pool.queries[10]?.text).toContain('FROM ageha_sync')
    expect(pool.queries[10]?.text).toContain('domain = $2')
    expect(pool.queries[10]?.values).toEqual(['u1', 'files'])

    await store.putSyncData('u1', 'settings', '{"settings":{}}')
    expect(pool.queries[11]?.text).toContain('INSERT INTO ageha_sync')
    expect(pool.queries[11]?.text).toContain('ON CONFLICT (user_id, domain)')
  })

  it('maps pg rows to records', async () => {
    const sessionPool = makeFakePool({
      rows: [{ token: 'tok', user_id: 'u1', expires_at: new Date(1234567890123).toISOString() }],
    })
    expect(await new PostgresDataStore(sessionPool).findSession('x')).toEqual({
      token: 'tok',
      userId: 'u1',
      expiresAt: 1234567890123,
    })

    const userPool = makeFakePool({
      rows: [
        {
          id: 'u1',
          username: 'alice',
          created_at: '2026-09-23T00:00:00.000Z',
          updated_at: '2026-09-23T00:00:00.000Z',
          password_hash: 'h',
          display_name: 'Alice',
          email: 'a@example.com',
          avatar: 'data:image/png;base64,QUJD',
        },
      ],
    })
    expect(await new PostgresDataStore(userPool).findUserById('u1')).toEqual(
      makeUser({
        passwordHash: 'h',
        displayName: 'Alice',
        email: 'a@example.com',
        avatar: 'data:image/png;base64,QUJD',
      }),
    )

    const nullProfilePool = makeFakePool({
      rows: [
        {
          id: 'u1',
          username: 'alice',
          created_at: '2026-09-23T00:00:00.000Z',
          updated_at: '2026-09-23T00:00:00.000Z',
          password_hash: 'h',
          display_name: null,
          email: null,
          avatar: null,
        },
      ],
    })
    expect(await new PostgresDataStore(nullProfilePool).findUserById('u1')).toEqual(
      makeUser({ passwordHash: 'h' }),
    )

    const emptyPool = makeFakePool()
    expect(await new PostgresDataStore(emptyPool).findUserByUsername('ghost')).toBeNull()
  })

  it('translates unique violations into UsernameTakenError and passes other errors through', async () => {
    const uniquePool = makeFakePool({ errorCode: '23505' })
    await expect(
      new PostgresDataStore(uniquePool).createUser(makeUser()),
    ).rejects.toBeInstanceOf(UsernameTakenError)

    const brokenPool = makeFakePool({ errorCode: '08003' })
    await expect(
      new PostgresDataStore(brokenPool).createUser(makeUser()),
    ).rejects.toEqual({ code: '08003' })
  })

  it('returns prune counts from rowCount', async () => {
    const pool = makeFakePool({ rowCount: 3 })
    expect(await new PostgresDataStore(pool).pruneExpiredSessions(1000)).toBe(3)
  })

  it('binds parameters for content sample writes and caps storage (样本上传切片)', async () => {
    const pool = makeFakePool()
    const store = new PostgresDataStore(pool)

    await store.createContentSample({
      id: 's1',
      text: '参数化写入',
      classification: 'ok',
      createdAt: '2026-09-28T00:00:00.000Z',
    })
    expect(pool.queries[0]?.text).toContain('INSERT INTO ageha_content_samples')
    expect(pool.queries[0]?.values).toEqual(['s1', '参数化写入', 'ok', '2026-09-28T00:00:00.000Z'])
    // 容量封顶：超出 MAX_CONTENT_SAMPLES 的最旧样本被清除。
    expect(pool.queries[1]?.text).toContain('DELETE FROM ageha_content_samples')
    expect(pool.queries[1]?.text).toContain('OFFSET $1')
    expect(pool.queries[1]?.values).toEqual([MAX_CONTENT_SAMPLES])

    const listPool = makeFakePool({
      rows: [
        {
          id: 's1',
          text: '参数化写入',
          classification: 'misleading',
          created_at: '2026-09-28T00:00:00.000Z',
        },
      ],
    })
    const samples = await new PostgresDataStore(listPool).listContentSamples()
    expect(listPool.queries[0]?.text).toContain('ORDER BY created_at DESC, id')
    expect(samples).toEqual([
      { id: 's1', text: '参数化写入', classification: 'misleading', createdAt: '2026-09-28T00:00:00.000Z' },
    ])

    const deletePool = makeFakePool({ rowCount: 1 })
    expect(await new PostgresDataStore(deletePool).deleteContentSample('s1')).toBe(true)
    expect(deletePool.queries[0]?.text).toContain('DELETE FROM ageha_content_samples WHERE id = $1')
    expect(deletePool.queries[0]?.values).toEqual(['s1'])

    const missingPool = makeFakePool()
    expect(await new PostgresDataStore(missingPool).deleteContentSample('ghost')).toBe(false)
  })
})
