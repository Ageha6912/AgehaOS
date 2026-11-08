import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app'
import { BROWSE_COOKIE, signGrant } from '../src/browse/grant'
import { canonicalJson, REMOTE_CATALOG_APPS, validateCatalogApps } from '../src/remote-catalog'
import { createStore } from '../src/store'
import { MemoryDataStore } from '../src/store/memory-store'
import { PostgresDataStore } from '../src/store/postgres-store'
import { loadOrCreateSigningKey, signPayload } from '../src/store-keys'

describe('remote store catalog (PRD §47 前置切片，ADR 18)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'agehaos-store-'))
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it('canonicalizes with stable key order across nesting', () => {
    const value = { b: 1, a: { d: [2, { c: 3, a: 1 }] }, z: undefined, a2: null }
    expect(canonicalJson(value)).toBe('{"a":{"d":[2,{"a":1,"c":3}]},"a2":null,"b":1}')
  })

  it('serves an Ed25519-signed catalog whose signature verifies against the published key', async () => {
    app = await buildApp({ signingKey: await loadOrCreateSigningKey(dir), logger: false })
    const response = await app.inject({ method: 'GET', url: '/api/store/catalog' })
    expect(response.statusCode).toBe(200)

    const body = response.json() as {
      keyId: string
      algorithm: string
      publicKey: string
      payload: { version: number; generatedAt: string; apps: unknown[] }
      signature: string
    }
    expect(body.algorithm).toBe('ed25519')
    expect(body.payload.version).toBe(1)
    expect(body.payload.apps).toHaveLength(REMOTE_CATALOG_APPS.length)
    expect(body.keyId).toMatch(/^[0-9a-f]{16}$/)

    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(body.publicKey, 'base64'),
    ])
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    const ok = cryptoVerify(
      null,
      Buffer.from(canonicalJson(body.payload), 'utf8'),
      publicKey,
      Buffer.from(body.signature, 'base64'),
    )
    expect(ok).toBe(true)
  })

  it('breaks verification when the payload is tampered', async () => {
    const signingKey = await loadOrCreateSigningKey(path.join(dir, 'second'))
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(signingKey.publicKeyBase64, 'base64'),
    ])
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    const payload = { version: 1 as const, generatedAt: 't', apps: REMOTE_CATALOG_APPS }
    const honestSignature = signPayload(signingKey.privateKey, canonicalJson(payload))
    const tamperedCanonical = canonicalJson({
      ...payload,
      apps: [{ ...REMOTE_CATALOG_APPS[0], name: '篡改后的应用' }],
    })
    const ok = cryptoVerify(
      null,
      Buffer.from(tamperedCanonical, 'utf8'),
      publicKey,
      Buffer.from(honestSignature, 'base64'),
    )
    expect(ok).toBe(false)
  })

  it('persists the signing key across restarts (keyId 稳定)', async () => {
    const first = await loadOrCreateSigningKey(dir)
    const second = await loadOrCreateSigningKey(dir)
    expect(second.keyId).toBe(first.keyId)
    expect(second.publicKeyBase64).toBe(first.publicKeyBase64)
    const raw = JSON.parse(await readFile(path.join(dir, 'store-signing-key.json'), 'utf8')) as {
      privateKey: string
    }
    expect(raw.privateKey).toContain('PRIVATE KEY')
  })
})

describe('browse grant secret（独立于公开目录材料）', () => {
  it('生成并持久化独立的 32 字节 browseSecret', async () => {
    const secretDir = await mkdtemp(path.join(tmpdir(), 'agehaos-browse-secret-'))
    const first = await loadOrCreateSigningKey(secretDir)
    expect(Buffer.from(first.browseSecret, 'base64')).toHaveLength(32)
    // 绝不能再是公开材料 keyId:publicKeyBase64 的派生。
    expect(first.browseSecret).not.toBe(`${first.keyId}:${first.publicKeyBase64}`)

    const second = await loadOrCreateSigningKey(secretDir)
    expect(second.browseSecret).toBe(first.browseSecret)
    const stored = JSON.parse(
      await readFile(path.join(secretDir, 'store-signing-key.json'), 'utf8'),
    ) as { browseSecret?: string }
    expect(stored.browseSecret).toBe(first.browseSecret)
  })

  it('旧密钥文件（无 browseSecret）原地升级且不换 Ed25519 对', async () => {
    const secretDir = await mkdtemp(path.join(tmpdir(), 'agehaos-browse-upgrade-'))
    const original = await loadOrCreateSigningKey(secretDir)
    const filePath = path.join(secretDir, 'store-signing-key.json')
    const legacy = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    delete legacy.browseSecret
    await writeFile(filePath, JSON.stringify(legacy, null, 2), 'utf8')

    const upgraded = await loadOrCreateSigningKey(secretDir)
    expect(upgraded.publicKeyBase64).toBe(original.publicKeyBase64)
    expect(upgraded.browseSecret).not.toBe('')
    expect(upgraded.browseSecret).not.toBe(original.browseSecret)
    const stored = JSON.parse(await readFile(filePath, 'utf8')) as { browseSecret?: string }
    expect(stored.browseSecret).toBe(upgraded.browseSecret)

    // 再次加载必须稳定（升级只发生一次）。
    const reloaded = await loadOrCreateSigningKey(secretDir)
    expect(reloaded.browseSecret).toBe(upgraded.browseSecret)
  })

  it('用公开目录材料伪造的 grant 被拒绝', async () => {
    const wiringDir = await mkdtemp(path.join(tmpdir(), 'agehaos-browse-wiring-'))
    const app2 = await buildApp({
      signingKey: await loadOrCreateSigningKey(wiringDir),
      logger: false,
    })
    try {
      const catalog = await app2.inject({ method: 'GET', url: '/api/store/catalog' })
      const body = catalog.json() as { keyId: string; publicKey: string }
      const forged = signGrant(`${body.keyId}:${body.publicKey}`, 'victim', 60_000, Date.now(), 'browse')
      const response = await app2.inject({
        method: 'GET',
        url: '/https/example.com/',
        headers: { cookie: `${BROWSE_COOKIE}=${forged}` },
      })
      expect(response.statusCode).toBe(401)
    } finally {
      await app2.close()
    }
  })
})

describe('签名密钥损坏保全（A1 审查轻微项）', () => {
  it('损坏文件改名 .corrupt-<ts> 保留、打审计 warn，并重建新钥', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agehaos-key-corrupt-'))
    const filePath = path.join(dir, 'store-signing-key.json')
    await writeFile(filePath, '{not json', 'utf8')

    const warnings: Array<Record<string, unknown>> = []
    const regenerated = await loadOrCreateSigningKey(dir, {
      warn: (entry) => warnings.push(entry),
    })
    expect(warnings.map((entry) => entry.audit)).toContain('catalog.key_regenerated')
    // 旧文件保留（可事后取证），目录里是新钥。
    const files = await readdir(dir)
    expect(files.some((name) => name.startsWith('store-signing-key.json.corrupt-'))).toBe(true)
    expect(files).toContain('store-signing-key.json')
    const reread = await loadOrCreateSigningKey(dir)
    expect(reread.keyId).toBe(regenerated.keyId)
  })

  it('结构不完整（可读 JSON 但缺字段）视同损坏，同样保留重建', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agehaos-key-partial-'))
    await writeFile(path.join(dir, 'store-signing-key.json'), '{"publicKey":123}', 'utf8')
    const warnings: Array<Record<string, unknown>> = []
    await loadOrCreateSigningKey(dir, { warn: (entry) => warnings.push(entry) })
    expect(warnings).toHaveLength(1)
    const files = await readdir(dir)
    expect(files.some((name) => name.startsWith('store-signing-key.json.corrupt-'))).toBe(true)
  })

  it('首次启动（无文件）不打 warn、不产生 corrupt 文件', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agehaos-key-fresh-'))
    const warnings: Array<Record<string, unknown>> = []
    await loadOrCreateSigningKey(dir, { warn: (entry) => warnings.push(entry) })
    expect(warnings).toHaveLength(0)
    const files = await readdir(dir)
    expect(files).toEqual(['store-signing-key.json'])
  })
})

describe('createStore（A2 审查轻微项：postgres 缺 DATABASE_URL 拒绝启动）', () => {
  it('显式 postgres + DATABASE_URL 缺失时抛错（不再静默连 libpq 默认库）', () => {
    expect(() =>
      createStore({ store: 'postgres', dataDir: 'unused', databaseUrl: null }),
    ).toThrowError(/DATABASE_URL is required/)
  })

  it('postgres + 显式连接串正常构造；memory/file 不受影响', () => {
    expect(
      createStore({ store: 'postgres', dataDir: 'unused', databaseUrl: 'postgres://localhost:1/ageha' }),
    ).toBeInstanceOf(PostgresDataStore)
    expect(createStore({ store: 'memory', dataDir: 'unused', databaseUrl: null })).toBeInstanceOf(
      MemoryDataStore,
    )
  })
})

describe('remote catalog 校验（A1 审查轻微项：window 未知键不入签名）', () => {
  it('window 带未知键 → 整体拒绝；正好三个键 → 通过', () => {
    const base = REMOTE_CATALOG_APPS[0]
    expect(validateCatalogApps([base])).not.toBeNull()
    expect(
      validateCatalogApps([{ ...base, window: { ...base.window, pinned: true } }]),
    ).toBeNull()
  })
})
