/**
 * 远端应用目录（PRD §47 前置切片，ADR 18）：随服务端发布的 App Store 增补目录。
 *
 * 发布边界（本切片裁决）：远程条目仍然只能指向同源 `/apps/sites/` 下的静态站点
 * （§30.3 来源 allowlist 不变），目录签名解决的是「目录被篡改/伪造」的完整性与
 * 来源问题，而不是放行任意外链。canonicalJson 必须与客户端
 * `src/core/apps/remote-catalog.ts` 的实现逐字节一致（有往返测试钉住）。
 */

export interface RemoteCatalogApp {
  id: string
  name: string
  version: string
  entry: string
  permissions: string[]
  window: { width: number; height: number; resizable: boolean }
  author: string
  description: string
}

export interface RemoteCatalogPayload {
  version: 1
  generatedAt: string
  apps: readonly RemoteCatalogApp[]
}

/** 仅经远程目录发布的样例应用（不在客户端内置 STORE_CATALOG 里）。 */
export const REMOTE_CATALOG_APPS: readonly RemoteCatalogApp[] = [
  {
    id: 'com.ageha.samples.counter',
    name: '计数器',
    version: '1.0.0',
    entry: '/apps/sites/counter/index.html',
    permissions: [],
    window: { width: 320, height: 280, resizable: true },
    author: 'AgehaOS Samples',
    description: '远程目录发布示例：经签名目录安装的零权限计数器。',
  },
]

/** 稳定键序的规范化 JSON（服务端与客户端各有一份实现，往返测试钉住一致）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}
