import { createHash, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { canonicalJson, fetchSignedCatalog } from './remote-catalog'

/**
 * 与服务端共用 Ed25519 语义（node:crypto 生成/签名，注入 verify），并钉住
 * 客户端 canonicalJson 与服务端实现逐字节一致。
 */

function makeSignedResponse(overrides?: {
  payloadApps?: readonly unknown[]
  tamperSignature?: boolean
  otherKey?: boolean
}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicKeyRaw = spkiDer.subarray(spkiDer.length - 32)
  const publicKeyBase64 = publicKeyRaw.toString('base64')

  const apps = overrides?.payloadApps ?? [
    {
      id: 'com.ageha.samples.counter',
      name: '计数器',
      version: '1.0.0',
      entry: '/apps/sites/counter/index.html',
      permissions: [],
      window: { width: 320, height: 280, resizable: true },
      author: 'AgehaOS Samples',
      description: '远程示例',
    },
    {
      id: 'com.ageha.evil',
      name: '越界应用',
      version: '1.0.0',
      entry: 'https://evil.example/app.html',
      permissions: ['storage'],
      window: { width: 320, height: 280, resizable: true },
      author: 'evil',
      description: 'entry 不在 allowlist 内',
    },
  ]
  const payload = { version: 1 as const, generatedAt: '2026-09-25T00:00:00.000Z', apps }
  const canonical = canonicalJson(payload)
  const signKey = overrides?.otherKey ? generateKeyPairSync('ed25519').privateKey : privateKey
  const signature = nodeSign(null, Buffer.from(canonical, 'utf8'), signKey).toString('base64')

  const response = {
    keyId: createHash('sha256').update(publicKeyRaw).digest('hex').slice(0, 16),
    algorithm: 'ed25519',
    publicKey: publicKeyBase64,
    payload,
    signature: overrides?.tamperSignature === true ? signature.slice(0, -4) + 'AAAA' : signature,
  }
  return { response, publicKeyBase64 }
}

const nodeWebcryptoVerify = async (
  publicKeyRaw: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> => {
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyRaw)])
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
  return nodeVerify(null, Buffer.from(data), key, Buffer.from(signature))
}

describe('remote catalog client (PRD §47 前置切片，ADR 18)', () => {
  it('canonicalizes with stable key order (与服务端实现共用同一测试字面量，往返钉住一致)', () => {
    // 该字面量同时是 server/test/store.test.ts 的断言值——两份实现必须逐字节一致。
    const value = { b: 1, a: { d: [2, { c: 3, a: 1 }] }, z: undefined, a2: null }
    expect(canonicalJson(value)).toBe('{"a":{"d":[2,{"a":1,"c":3}]},"a2":null,"b":1}')
  })

  it('verifies a signed catalog and drops allowlist-violating entries', async () => {
    const { response } = makeSignedResponse()
    const result = await fetchSignedCatalog({
      fetchJson: async () => response,
      verify: nodeWebcryptoVerify,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.apps.map((app) => app.id)).toEqual(['com.ageha.samples.counter'])
    }
  })

  it('rejects a tampered signature', async () => {
    const { response } = makeSignedResponse({ tamperSignature: true })
    const result = await fetchSignedCatalog({
      fetchJson: async () => response,
      verify: nodeWebcryptoVerify,
    })
    expect(result).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects a catalog whose published key does not match the pin', async () => {
    const { response } = makeSignedResponse({ otherKey: true })
    const result = await fetchSignedCatalog({
      fetchJson: async () => response,
      verify: nodeWebcryptoVerify,
      pinnedPublicKeyBase64: 'cGlubmVkLWtleQ==',
    })
    expect(result).toEqual({ ok: false, reason: 'untrusted-key' })
  })

  it('maps transport failure to unavailable', async () => {
    const result = await fetchSignedCatalog({
      fetchJson: async () => {
        throw new Error('offline')
      },
    })
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('钉扎键配置边界（B2 审查）', () => {
  it('空串钉扎键按配置错误 fail-closed（不再静默信任服务端键）', async () => {
    const { response } = makeSignedResponse()
    const result = await fetchSignedCatalog({
      fetchJson: async () => response,
      verify: nodeWebcryptoVerify,
      pinnedPublicKeyBase64: '   ',
    })
    expect(result).toEqual({ ok: false, reason: 'untrusted-key' })
  })
})
