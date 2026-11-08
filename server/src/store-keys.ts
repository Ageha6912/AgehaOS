import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  /**
   * 浏览器子域 grant 的 HMAC 密钥（32 字节随机，随密钥文件持久化）。
   * 必须独立于 keyId/publicKeyBase64——后两者经 /api/store/catalog 公开，
   * 由它们派生会让任何匿名访问者伪造 browse grant。
   */
  browseSecret: string
}

export function keyIdOf(publicKeyRaw: Buffer): string {
  return createHash('sha256').update(publicKeyRaw).digest('hex').slice(0, 16)
}

/** 密钥损坏时保留旧文件的审计回调（宿主接 pino）。 */
export interface SigningKeyLog {
  warn: (entry: Record<string, unknown>, message: string) => void
}

export async function loadOrCreateSigningKey(
  dataDir: string,
  log?: SigningKeyLog,
): Promise<CatalogSigningKey> {
  await mkdir(dataDir, { recursive: true })
  const filePath = path.join(dataDir, 'store-signing-key.json')
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
      publicKey?: string
      privateKey?: string
      browseSecret?: string
    }
    if (typeof raw.publicKey === 'string' && typeof raw.privateKey === 'string') {
      const publicKeyBase64 = raw.publicKey
      const keyId = keyIdOf(Buffer.from(publicKeyBase64, 'base64'))
      let browseSecret = typeof raw.browseSecret === 'string' ? raw.browseSecret : ''
      if (browseSecret === '') {
        // 旧密钥文件升级：保留既有 Ed25519 对（目录签名不失效），补写独立
        // browseSecret；此后旧 grant 全部失效（发布说明见 CHANGELOG）。
        browseSecret = randomBytes(32).toString('base64')
        await writeFile(
          filePath,
          JSON.stringify(
            { publicKey: publicKeyBase64, privateKey: raw.privateKey, browseSecret },
            null,
            2,
          ),
          { encoding: 'utf8', mode: 0o600 },
        )
      }
      return {
        keyId,
        publicKeyBase64,
        privateKey: createPrivateKey(raw.privateKey),
        browseSecret,
      }
    }
    // 文件可读但结构不完整：视同损坏，走下方保留 + 重建路径。
    await preserveCorruptKeyFile(filePath, log)
  } catch (cause) {
    const code = (cause as { code?: unknown }).code
    if (code !== 'ENOENT') {
      // 读不出（JSON 损坏/EACCES 等）≠ 首次启动：静默换钥会让全部历史目录
      // 签名失效且无审计痕迹。先把旧文件改名保留（失败忽略），再重建并 warn。
      await preserveCorruptKeyFile(filePath, log)
    }
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicKeyRaw = spkiDer.subarray(spkiDer.length - 32)
  const publicKeyBase64 = publicKeyRaw.toString('base64')
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const browseSecret = randomBytes(32).toString('base64')
  await writeFile(
    filePath,
    JSON.stringify({ publicKey: publicKeyBase64, privateKey: privatePem, browseSecret }, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )
  return {
    keyId: keyIdOf(publicKeyRaw),
    publicKeyBase64,
    privateKey: createPrivateKey(privatePem),
    browseSecret,
  }
}

/** 损坏密钥文件改名保留（`.corrupt-<ts>` 后缀）并打审计 warn；改名失败不阻断重建。 */
async function preserveCorruptKeyFile(filePath: string, log?: SigningKeyLog): Promise<void> {
  log?.warn({ audit: 'catalog.key_regenerated', filePath }, 'signing key file unreadable; kept a copy and regenerated')
  try {
    await rename(filePath, `${filePath}.corrupt-${Date.now()}`)
  } catch {
    // 首次启动（文件不存在）或无权限：无可保留内容，直接重建。
  }
}

/** Ed25519 签名（返回 base64），输入为规范化 JSON 的 UTF-8 字节。 */
export function signPayload(privateKey: KeyObject, canonical: string): string {
  return sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64')
}
