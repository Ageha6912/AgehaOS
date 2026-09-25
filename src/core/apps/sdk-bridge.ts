import type { Permission } from '../permissions'

/**
 * Type C SDK 桥（PRD §8.1、§10、§17、§30.1）：沙箱应用经 postMessage 请求系统能力，
 * 每个入口先过 `requiredPermission`（Default Deny），存储按 appId 命名空间隔离，
 * 文件访问钳制在应用专属目录 `/Apps/<appId>/`（Scoped Access，§10.3）。
 *
 * 本模块为纯函数 + 注入式 IO（core 框架无关）；React 侧 WebAppFrame 负责真正的
 * postMessage 收发与 localStorage/VFS 注入。能力面：
 * - `storage`（permission: `storage`）：按应用隔离的键值存储
 * - `window`（permission: `window`）：setTitle
 * - `theme`（无权限要求）：读取当前明暗主题（只读、无用户数据）
 * - `notification`（permission: `notification`，PRD §16/§17）：发送应用通知（字面文本）
 * - `files`（permissions: `filesystem.read` / `filesystem.write`，PRD §17）：
 *   应用主目录内的读/写/列/建/删——按动作校验对应权限
 */

export type SdkApi = 'storage' | 'window' | 'theme' | 'notification' | 'files'

export interface SdkRequest {
  reqId: string
  api: SdkApi
  action: string
  params: Record<string, unknown>
}

export interface SdkResponse {
  reqId: string
  ok: boolean
  data?: unknown
  error?: string
}

/** SDK 请求信封类型（客户端库 postMessage 的 type 字段）。 */
export const SDK_REQUEST_TYPE = 'agehaos:sdk'
export const SDK_RESULT_TYPE = 'agehaos:sdk-result'

const APIS: readonly SdkApi[] = ['storage', 'window', 'theme', 'notification', 'files']

/** 静态权限映射；`files` 按动作分权限（见 requiredPermission）。 */
const STATIC_API_PERMISSIONS: Record<Exclude<SdkApi, 'files'>, Permission | null> = {
  storage: 'storage',
  window: 'window',
  theme: null,
  notification: 'notification',
}

/** files 的只读动作集合；其余已知动作需要 filesystem.write。 */
const FILE_READ_ACTIONS: readonly string[] = ['read', 'list']

/** 每请求所需权限；null = 免许可的只读能力。未知动作按读取权限对待（由处理器回 unknown-action）。 */
export function requiredPermission(api: SdkApi, action: string): Permission | null {
  if (api === 'files') {
    return FILE_READ_ACTIONS.includes(action) ? 'filesystem.read' : 'filesystem.write'
  }
  return STATIC_API_PERMISSIONS[api]
}

/** 量化上限（Scoped Access）：键名 1–64、单值 ≤32KB、每应用 ≤64 键 / ≤256KB。 */
export const SDK_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/
export const SDK_MAX_VALUE_BYTES = 32 * 1024
export const SDK_MAX_KEYS = 64
export const SDK_MAX_TOTAL_BYTES = 256 * 1024
export const SDK_MAX_TITLE_LENGTH = 120
/** 通知字面文本上限（SDK 文本属应用内容，非系统文案）。 */
export const SDK_NOTIFICATION_TITLE_MAX = 64
export const SDK_NOTIFICATION_BODY_MAX = 200
/** SDK 单文件内容上限（UTF-8 字节）。 */
export const SDK_MAX_FILE_BYTES = 256 * 1024
/** SDK 路径参数上限。 */
export const SDK_PATH_MAX_LENGTH = 512

/** 请求解析：白名单类型 + 严格形状，任何多余/缺失字段返回 null（丢弃）。 */
export function parseSdkRequest(data: unknown): SdkRequest | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  if (raw.type !== SDK_REQUEST_TYPE) return null
  const { reqId, api, action, params } = raw as Record<string, unknown>
  if (typeof reqId !== 'string' || reqId === '' || reqId.length > 64) return null
  if (typeof api !== 'string' || !APIS.includes(api as SdkApi)) return null
  if (typeof action !== 'string' || action === '' || action.length > 32) return null
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null
  const extra = Object.keys(raw).filter((key) => key !== 'type')
  if (extra.length !== 4 || !['reqId', 'api', 'action', 'params'].every((k) => extra.includes(k))) {
    return null
  }
  return { reqId, api: api as SdkApi, action, params: params as Record<string, unknown> }
}

/** 注入式 KV 存储（与 PermissionStorage 同形状，测试可换内存实现）。 */
export interface SdkKvStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 注入式文件端口（绝对路径上的 VFS 子集；测试可换内存实现）。 */
export interface SdkFilePort {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  listDir(path: string): Promise<Array<{ name: string; type: 'file' | 'directory' }>>
  createDirectory(path: string): Promise<void>
  remove(path: string): Promise<void>
}

/** SDK 通知出口：宿主把它接到通知中心（appId 归属调用应用）。 */
export interface SdkNotification {
  title: string
  body: string
}

export interface SdkContext {
  appId: string
  hasPermission: (permission: Permission) => boolean
  onPermissionDenied: (permission: Permission) => void
  storage: SdkKvStorage
  getTheme: () => 'light' | 'dark'
  onTitle: (title: string) => void
  /** notification API 出口；缺省时该 API 回 unavailable。 */
  notify?: (notification: SdkNotification) => void
  /** files API 端口；缺省时该 API 回 unavailable。 */
  fs?: SdkFilePort
}

export function sdkStorageNamespace(appId: string): string {
  return `agehaos.sdk.storage.${appId}`
}

function readNamespace(ctx: SdkContext): Record<string, unknown> {
  let raw: string
  try {
    raw = ctx.storage.getItem(sdkStorageNamespace(ctx.appId)) ?? ''
  } catch {
    return {}
  }
  if (raw === '') return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* corrupted namespace: start empty */
  }
  return {}
}

function writeNamespace(ctx: SdkContext, data: Record<string, unknown>): boolean {
  try {
    ctx.storage.setItem(sdkStorageNamespace(ctx.appId), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

function byteLengthOf(value: string): number {
  return new TextEncoder().encode(value).length
}

function ok(reqId: string, data?: unknown): SdkResponse {
  return { reqId, ok: true, data }
}

function fail(reqId: string, error: string): SdkResponse {
  return { reqId, ok: false, error }
}

/** 应用专属主目录（文件访问的唯一可见范围）。 */
export function sdkAppRoot(appId: string): string {
  return `/Apps/${appId}`
}

/** 控制字符判定（C0 + DEL）；不用正则以规避字面控制字符。 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code === 127) return true
  }
  return false
}

/** 控制字符折叠为空格（通知文本清洗用）。 */
function collapseControlChars(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 32 || code === 127 ? ' ' : ch
  }
  return out.replace(/ +/g, ' ')
}

/**
 * 把 SDK 路径参数钳制到应用主目录内：接受相对（'a/b.txt'）与带前导 '/'
 * 的写法，拒绝 `..` 上跳、空段与控制字符；返回绝对路径。
 */
export function resolveSdkPath(appId: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > SDK_PATH_MAX_LENGTH) return null
  if (hasControlChars(trimmed)) return null
  const relative = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const segments = relative.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) return sdkAppRoot(appId)
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return `${sdkAppRoot(appId)}/${segments.join('/')}`
}

/** 通知字面文本清洗：去控制字符、去首尾空白、限长。 */
function sanitizeNotificationText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = collapseControlChars(value).trim()
  if (cleaned === '' || cleaned.length > max) return null
  return cleaned
}

/** 能力分发：权限门禁 → 动作路由 → 注入 IO。任何失败都以 {ok:false} 回执。 */
export async function handleSdkRequest(request: SdkRequest, ctx: SdkContext): Promise<SdkResponse> {
  const permission = requiredPermission(request.api, request.action)
  if (permission !== null && !ctx.hasPermission(permission)) {
    ctx.onPermissionDenied(permission)
    return fail(request.reqId, 'permission-denied')
  }

  switch (request.api) {
    case 'storage':
      return handleStorage(request, ctx)
    case 'window':
      return handleWindow(request, ctx)
    case 'theme':
      return request.action === 'get' ? ok(request.reqId, { theme: ctx.getTheme() }) : fail(request.reqId, 'unknown-action')
    case 'notification':
      return handleNotification(request, ctx)
    case 'files':
      return handleFiles(request, ctx)
  }
}

function handleStorage(request: SdkRequest, ctx: SdkContext): SdkResponse {
  const { reqId, action, params } = request
  const key = typeof params.key === 'string' ? params.key : null

  if (action === 'get') {
    if (key === null || !SDK_KEY_PATTERN.test(key)) return fail(reqId, 'invalid-key')
    const data = readNamespace(ctx)
    return ok(reqId, { value: key in data ? data[key] : null })
  }

  if (action === 'set') {
    if (key === null || !SDK_KEY_PATTERN.test(key)) return fail(reqId, 'invalid-key')
    if (params.value === undefined) return fail(reqId, 'invalid-value')
    const encoded = JSON.stringify(params.value)
    if (byteLengthOf(encoded) > SDK_MAX_VALUE_BYTES) return fail(reqId, 'value-too-large')
    const data = readNamespace(ctx)
    const isNew = !(key in data)
    if (isNew && Object.keys(data).length >= SDK_MAX_KEYS) return fail(reqId, 'too-many-keys')
    const withoutOld = byteLengthOf(JSON.stringify(data)) - (isNew ? 0 : byteLengthOf(JSON.stringify(data[key])))
    if (withoutOld + byteLengthOf(encoded) > SDK_MAX_TOTAL_BYTES) return fail(reqId, 'quota-exceeded')
    data[key] = params.value
    return writeNamespace(ctx, data) ? ok(reqId, {}) : fail(reqId, 'storage-unavailable')
  }

  if (action === 'remove') {
    if (key === null || !SDK_KEY_PATTERN.test(key)) return fail(reqId, 'invalid-key')
    const data = readNamespace(ctx)
    delete data[key]
    return writeNamespace(ctx, data) ? ok(reqId, {}) : fail(reqId, 'storage-unavailable')
  }

  if (action === 'keys') {
    return ok(reqId, { keys: Object.keys(readNamespace(ctx)) })
  }

  return fail(reqId, 'unknown-action')
}

function handleWindow(request: SdkRequest, ctx: SdkContext): SdkResponse {
  const { reqId, action, params } = request
  if (action === 'setTitle') {
    const title = typeof params.title === 'string' ? params.title.trim() : ''
    if (title === '' || title.length > SDK_MAX_TITLE_LENGTH) return fail(reqId, 'invalid-title')
    ctx.onTitle(title)
    return ok(reqId, {})
  }
  return fail(reqId, 'unknown-action')
}

function handleNotification(request: SdkRequest, ctx: SdkContext): SdkResponse {
  const { reqId, action, params } = request
  if (action !== 'show') return fail(reqId, 'unknown-action')
  if (!ctx.notify) return fail(reqId, 'unavailable')
  const title = sanitizeNotificationText(params.title, SDK_NOTIFICATION_TITLE_MAX)
  const body = sanitizeNotificationText(params.body, SDK_NOTIFICATION_BODY_MAX)
  if (title === null || body === null) return fail(reqId, 'invalid-text')
  ctx.notify({ title, body })
  return ok(reqId, {})
}

async function handleFiles(request: SdkRequest, ctx: SdkContext): Promise<SdkResponse> {
  const { reqId, action, params } = request
  const port = ctx.fs
  if (!port) return fail(reqId, 'unavailable')
  const path = resolveSdkPath(ctx.appId, params.path)
  if (path === null) return fail(reqId, 'invalid-path')

  const ensureRoot = async (): Promise<void> => {
    try {
      await port.createDirectory(sdkAppRoot(ctx.appId))
    } catch (error) {
      if ((error as { code?: string }).code !== 'already-exists') throw error
    }
  }

  try {
    if (action === 'read') {
      const content = await port.readFile(path)
      return ok(reqId, { content })
    }
    if (action === 'list') {
      const entries = await port.listDir(path)
      return ok(reqId, { entries })
    }
    if (action === 'write') {
      const content = params.content === undefined ? '' : params.content
      if (typeof content !== 'string') return fail(reqId, 'invalid-content')
      if (byteLengthOf(content) > SDK_MAX_FILE_BYTES) return fail(reqId, 'content-too-large')
      await ensureRoot()
      await port.writeFile(path, content)
      return ok(reqId, {})
    }
    if (action === 'mkdir') {
      await ensureRoot()
      await port.createDirectory(path)
      return ok(reqId, {})
    }
    if (action === 'remove') {
      if (path === sdkAppRoot(ctx.appId)) return fail(reqId, 'root-protected')
      await port.remove(path)
      return ok(reqId, {})
    }
    return fail(reqId, 'unknown-action')
  } catch (error) {
    return fail(reqId, (error as { code?: string }).code ?? 'fs-error')
  }
}
