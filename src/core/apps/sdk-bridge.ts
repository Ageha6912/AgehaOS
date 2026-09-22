import type { Permission } from '../permissions'

/**
 * Type C SDK 桥（PRD §8.1、§10、§30.1）：沙箱应用经 postMessage 请求系统能力，
 * 每个入口先过 `hasPermission`（Default Deny），存储按 appId 命名空间隔离（Scoped Access）。
 *
 * 本模块为纯函数 + 注入式 IO（core 框架无关）；React 侧 WebAppFrame 负责真正的
 * postMessage 收发与 localStorage 注入。第一阶段能力面：
 * - `storage`（permission: `storage`）：按应用隔离的键值存储
 * - `window`（permission: `window`）：setTitle
 * - `theme`（无权限要求）：读取当前明暗主题（只读、无用户数据）
 */

export type SdkApi = 'storage' | 'window' | 'theme'

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

const APIS: readonly SdkApi[] = ['storage', 'window', 'theme']

/** 每个 API 所需的权限；null = 免许可的只读能力。 */
export const SDK_API_PERMISSIONS: Record<SdkApi, Permission | null> = {
  storage: 'storage',
  window: 'window',
  theme: null,
}

/** 量化上限（Scoped Access）：键名 1–64、单值 ≤32KB、每应用 ≤64 键 / ≤256KB。 */
export const SDK_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/
export const SDK_MAX_VALUE_BYTES = 32 * 1024
export const SDK_MAX_KEYS = 64
export const SDK_MAX_TOTAL_BYTES = 256 * 1024
export const SDK_MAX_TITLE_LENGTH = 120

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

export interface SdkContext {
  appId: string
  hasPermission: (permission: Permission) => boolean
  onPermissionDenied: (permission: Permission) => void
  storage: SdkKvStorage
  getTheme: () => 'light' | 'dark'
  onTitle: (title: string) => void
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

/** 能力分发：权限门禁 → 动作路由 → 注入 IO。任何失败都以 {ok:false} 回执。 */
export function handleSdkRequest(request: SdkRequest, ctx: SdkContext): SdkResponse {
  const permission = SDK_API_PERMISSIONS[request.api]
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
