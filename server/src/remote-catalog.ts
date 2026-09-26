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

/** PRD §10.1 的 MVP 权限名（与服务端注册面共用这一份清单）。 */
export const MVP_PERMISSION_NAMES: readonly string[] = [
  'filesystem.read',
  'filesystem.write',
  'storage',
  'notification',
  'clipboard',
  'window',
  'network',
]

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/
const ENTRY_PATTERN = /^\/apps\/sites\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/index\.html$/
const SEMVERISH = /^[0-9]+(\.[0-9]+){0,3}$/

/**
 * 管理员发布目录的深度校验（ADR 20）：白名单字段、逐项形状与边界——entry
 * 必须落在同源 /apps/sites/ allowlist 内（签名解决来源，allowlist 限制范围）。
 * 全量通过才返回清洗后的数组；任何一项非法返回 null（路由回 400）。
 */
export function validateCatalogApps(input: unknown): RemoteCatalogApp[] | null {
  if (!Array.isArray(input) || input.length > 50) return null
  const apps: RemoteCatalogApp[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return null
    const v = raw as Record<string, unknown>
    if (Object.keys(v).length !== 8) return null
    if (
      typeof v.id !== 'string' || !ID_PATTERN.test(v.id) || seen.has(v.id) ||
      typeof v.name !== 'string' || v.name.length < 1 || v.name.length > 64 ||
      typeof v.version !== 'string' || !SEMVERISH.test(v.version) ||
      typeof v.entry !== 'string' || !ENTRY_PATTERN.test(v.entry) ||
      !Array.isArray(v.permissions) ||
      v.permissions.some((p) => typeof p !== 'string' || !MVP_PERMISSION_NAMES.includes(p)) ||
      typeof v.window !== 'object' || v.window === null ||
      typeof (v.window as Record<string, unknown>).width !== 'number' ||
      typeof (v.window as Record<string, unknown>).height !== 'number' ||
      typeof (v.window as Record<string, unknown>).resizable !== 'boolean' ||
      !Number.isInteger((v.window as { width: number }).width) ||
      !Number.isInteger((v.window as { height: number }).height) ||
      (v.window as { width: number }).width < 200 || (v.window as { width: number }).width > 2000 ||
      (v.window as { height: number }).height < 200 || (v.window as { height: number }).height > 2000 ||
      typeof v.author !== 'string' || v.author.length < 1 || v.author.length > 64 ||
      typeof v.description !== 'string' || v.description.length > 200
    ) {
      return null
    }
    seen.add(v.id)
    apps.push({
      id: v.id,
      name: v.name,
      version: v.version,
      entry: v.entry,
      permissions: v.permissions as string[],
      window: v.window as RemoteCatalogApp['window'],
      author: v.author,
      description: v.description,
    })
  }
  return apps
}
