import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app'
import { canonicalJson, REMOTE_CATALOG_APPS } from '../src/remote-catalog'
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
