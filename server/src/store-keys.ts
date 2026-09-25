import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 远端应用目录的签名密钥（PRD §47 前置切片，ADR 18）：
 * Ed25519 密钥对，私钥只存服务端数据目录（0600），公钥（raw 32 字节 base64）
 * 随目录响应下发并用 keyId（公钥 SHA-256 短哈希）标识。生产部署应把公钥钉扎
 * 进客户端构建（VITE_STORE_CATALOG_PUBLIC_KEY），使「服务器被攻破也无法
 * 伪造历史目录」；本地开发默认信任服务端下发键。
 */

export interface CatalogSigningKey {
  /** 公钥 SHA-256 前 16 hex。 */
  keyId: string
  /** raw 32 字节公钥，base64。 */
  publicKeyBase64: string
  privateKey: KeyObject
}

export function keyIdOf(publicKeyRaw: Buffer): string {
  return createHash('sha256').update(publicKeyRaw).digest('hex').slice(0, 16)
}

export async function loadOrCreateSigningKey(dataDir: string): Promise<CatalogSigningKey> {
  await mkdir(dataDir, { recursive: true })
  const filePath = path.join(dataDir, 'store-signing-key.json')
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { publicKey?: string; privateKey?: string }
    if (typeof raw.publicKey === 'string' && typeof raw.privateKey === 'string') {
      return {
        keyId: keyIdOf(Buffer.from(raw.publicKey, 'base64')),
        publicKeyBase64: raw.publicKey,
        privateKey: createPrivateKey(raw.privateKey),
      }
    }
  } catch {
    // first boot or corrupted file: fall through and regenerate
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicKeyRaw = spkiDer.subarray(spkiDer.length - 32)
  const publicKeyBase64 = publicKeyRaw.toString('base64')
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  await writeFile(filePath, JSON.stringify({ publicKey: publicKeyBase64, privateKey: privatePem }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  return { keyId: keyIdOf(publicKeyRaw), publicKeyBase64, privateKey: createPrivateKey(privatePem) }
}

/** Ed25519 签名（返回 base64），输入为规范化 JSON 的 UTF-8 字节。 */
export function signPayload(privateKey: KeyObject, canonical: string): string {
  return sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64')
}
