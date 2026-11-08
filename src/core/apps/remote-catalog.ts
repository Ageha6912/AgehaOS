import { isAllowedWebAppEntry } from './web-app'
import { parseManifest } from '../runtime/manifest'
import type { AppManifest } from '../runtime/manifest'

/**
 * 远端应用目录客户端（PRD §47 前置切片，ADR 18）：拉取签名目录 → 校验形状 →
 * 公钥钉扎检查 → WebCrypto Ed25519 验签 → parseManifest + 同源 allowlist 过滤。
 * 任何一步失败都整包拒绝（不部分采纳），返回结构化原因。
 *
 * 信任锚：生产构建应通过 `VITE_STORE_CATALOG_PUBLIC_KEY`（raw 公钥 base64）
 * 钉扎发布方公钥；未钉扎（本地开发）时接受服务端下发键。
 */

export interface RemoteCatalogResponse {
  keyId: string
  algorithm: string
  publicKey: string
  payload: RemoteCatalogPayloadLike
  signature: string
}

export interface RemoteCatalogPayloadLike {
  version: number
  generatedAt: string
  apps: readonly unknown[]
}

export type RemoteCatalogResult =
  | { ok: true; apps: AppManifest[] }
  | { ok: false; reason: 'unavailable' | 'bad-shape' | 'untrusted-key' | 'bad-algorithm' | 'bad-signature' | 'no-valid-apps' }

export interface RemoteCatalogDeps {
  /** 注入式取数（默认 fetch 同源 /api/store/catalog）；测试替换。 */
  fetchJson?: (url: string) => Promise<unknown>
  /** 注入式验签（默认 WebCrypto Ed25519）；测试替换。 */
  verify?: (publicKeyRaw: Uint8Array, data: Uint8Array, signature: Uint8Array) => Promise<boolean>
  /** 钉扎公钥（raw base64）；缺省接受服务端下发键（开发模式）。 */
  pinnedPublicKeyBase64?: string | null
}

/** 稳定键序规范化 JSON——必须与 server/src/remote-catalog.ts 逐字节一致（有测试）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

const CATALOG_URL = '/api/store/catalog'

function isRemoteCatalogResponse(value: unknown): value is RemoteCatalogResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<RemoteCatalogResponse>
  return (
    typeof v.keyId === 'string' &&
    v.algorithm === 'ed25519' &&
    typeof v.publicKey === 'string' &&
    typeof v.signature === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null &&
    (v.payload as Partial<RemoteCatalogPayloadLike>).version === 1 &&
    Array.isArray((v.payload as RemoteCatalogPayloadLike).apps)
  )
}

async function webcryptoVerify(
  publicKeyRaw: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', publicKeyRaw as BufferSource, { name: 'Ed25519' }, false, [
    'verify',
  ])
  return crypto.subtle.verify({ name: 'Ed25519' }, key, signature as BufferSource, data as BufferSource)
}

/** 拉取并验签远端目录；成功返回通过 manifest 校验与 allowlist 过滤的应用清单。 */
export async function fetchSignedCatalog(deps: RemoteCatalogDeps = {}): Promise<RemoteCatalogResult> {
  const fetchJson = deps.fetchJson ?? (async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error('unavailable')
    return response.json()
  })
  const verify = deps.verify ?? webcryptoVerify

  let raw: unknown
  try {
    raw = await fetchJson(CATALOG_URL)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (!isRemoteCatalogResponse(raw)) return { ok: false, reason: 'bad-shape' }
  // 钉扎键区分「未配置」与「配置为空串」（B2 审查）：'' 是配置错误，
  // fail-closed 拒绝——静默信任服务端下发键会让钉扎形同虚设。
  if (typeof deps.pinnedPublicKeyBase64 === 'string' && deps.pinnedPublicKeyBase64.trim() === '') {
    return { ok: false, reason: 'untrusted-key' }
  }
  if (deps.pinnedPublicKeyBase64 && deps.pinnedPublicKeyBase64 !== raw.publicKey) {
    return { ok: false, reason: 'untrusted-key' }
  }

  const data = new TextEncoder().encode(canonicalJson(raw.payload))
  let signatureOk: boolean
  try {
    signatureOk = await verify(
      Uint8Array.from(atob(raw.publicKey), (ch) => ch.charCodeAt(0)),
      data,
      Uint8Array.from(atob(raw.signature), (ch) => ch.charCodeAt(0)),
    )
  } catch {
    signatureOk = false
  }
  if (!signatureOk) return { ok: false, reason: 'bad-signature' }

  const apps: AppManifest[] = []
  for (const candidate of raw.payload.apps) {
    const parsed = parseManifest(candidate)
    if (!parsed.ok) continue
    if (!isAllowedWebAppEntry(parsed.manifest.entry)) continue
    apps.push(parsed.manifest)
  }
  if (apps.length === 0) return { ok: false, reason: 'no-valid-apps' }
  return { ok: true, apps }
}
