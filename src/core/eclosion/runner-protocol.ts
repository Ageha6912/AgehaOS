/**
 * 羽化宿主 ↔ runner 的 postMessage 白名单 schema（设计 §4.1 第 3 条、§4.2）。
 *
 * 两个方向、各恰四类消息，多余字段丢弃、未知类型拒绝（返回 null，不是宽松解析）：
 *
 * 宿主 → runner：
 * - `agehaos:hello`     握手（iframe load 后宿主先发）
 * - `eclosion:chunk`    { seq, html } 增量标记片（仅闭合元素，绝不含 script）
 * - `eclosion:power-on` { scripts, capabilities } 破茧：注入宿主侧截留的脚本，
 *   并随信声明 SDK 能力（runner 据此安装 window.AgehaOS 客户端）
 * - `agehaos:sdk-result`  SDK 回执（与 Type C 桥同信封；runner 按 reqId 关联）
 *
 * runner → 宿主（§4.1 第 3 条枚举的四类）：
 * - `agehaos:ready`     runner 加载完成
 * - `agehaos:sdk`       生成代码发起的 SDK 请求（复用 sdk-bridge 的严格解析）
 * - `eclosion:rendered` 破茧完成
 * - `eclosion:error`    { message } 脚本运行期错误（window.onerror）
 *
 * 传输侧另有 §4.1 第 3 条的前置闸：宿主只接受 `event.source === iframe.contentWindow`
 * 严格相等的消息（web-app-frame.tsx 同款）；runner 只接受 `event.source === parent`。
 *
 * 本模块为纯函数（core 框架无关）；public/apps/runtime/eclosion-runner.js 内有同构的
 * JS 版校验（沙箱页无法 import 本模块），两侧由 e2e 与单测共同钉住行为。
 */

import { parseSdkRequest, SDK_RESULT_TYPE, type SdkApi, type SdkRequest, type SdkResponse } from '../apps/sdk-bridge'
import type { Permission } from '../permissions'

export const ECLOSION_CHUNK_TYPE = 'eclosion:chunk'
export const ECLOSION_POWER_ON_TYPE = 'eclosion:power-on'
export const ECLOSION_RENDERED_TYPE = 'eclosion:rendered'
export const ECLOSION_ERROR_TYPE = 'eclosion:error'

/**
 * SDK 能力声明（宿主 → runner，随 `eclosion:power-on` 下发）：runner 据此安装
 * `window.AgehaOS` 客户端（§4.1 第 4 条 Default Deny——**未列出的命名空间在
 * AgehaOS 对象上不存在**，而不是「存在但被拒」），生成代码可特性检测分支：
 * `if (window.AgehaOS && AgehaOS.storage)`。
 */
export interface EclosionSdkCapabilities {
  /** 可用 API 命名空间（恒含免许可只读的 theme；L2/L3 恒仅 theme）。 */
  apis: readonly SdkApi[]
}

/** 羽化能力面：免许可只读 theme + 可经规格授权的四个命名空间。 */
export const ECLOSION_SDK_APIS: readonly SdkApi[] = ['theme', 'storage', 'window', 'notification', 'files']

/**
 * 规格权限 → SDK 能力声明。权限**恒来自规格表**（§5.2：L1 按各自 permissions；
 * L2/L3 今日/想象应用传 `[]` → 仅 theme，其余 SDK 调用一律被宿主拒绝）。
 * 这是 power-on 能力声明的唯一推导处，不读 permissionManager 的运行时授予。
 */
export function sdkCapabilitiesForPermissions(permissions: readonly Permission[]): EclosionSdkCapabilities {
  const apis: SdkApi[] = ['theme']
  if (permissions.includes('storage')) apis.push('storage')
  if (permissions.includes('window')) apis.push('window')
  if (permissions.includes('notification')) apis.push('notification')
  if (permissions.includes('filesystem.read') || permissions.includes('filesystem.write')) {
    apis.push('files')
  }
  return { apis }
}

export type HostToRunnerMessage =
  | { type: 'agehaos:hello' }
  | { type: 'eclosion:chunk'; seq: number; html: string }
  | { type: 'eclosion:power-on'; scripts: string[]; capabilities: EclosionSdkCapabilities }
  | ({ type: 'agehaos:sdk-result' } & SdkResponse)

export type RunnerToHostMessage =
  | { type: 'agehaos:ready' }
  | ({ type: 'agehaos:sdk' } & SdkRequest)
  | { type: 'eclosion:rendered' }
  | { type: 'eclosion:error'; message: string }

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}

function hasExactKeys(raw: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(raw).length === keys.length && keys.every((key) => key in raw)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** 校验能力声明：恰一键 apis、非空、成员全部属于 ECLOSION_SDK_APIS 且不重复。 */
function isSdkCapabilities(value: unknown): value is EclosionSdkCapabilities {
  if (!isObject(value) || !hasExactKeys(value, ['apis'])) return false
  if (!Array.isArray(value.apis) || value.apis.length === 0) return false
  const seen = new Set<string>()
  return value.apis.every((api) => {
    if (typeof api !== 'string' || !ECLOSION_SDK_APIS.includes(api as SdkApi)) return false
    if (seen.has(api)) return false
    seen.add(api)
    return true
  })
}

/**
 * 校验 SDK 回执（宿主 → runner）：信封 { type, reqId, ok }，成功可带 data、
 * 失败必带 error，成功不得带 error。
 */
function parseSdkResultEnvelope(data: unknown): HostToRunnerMessage | null {
  if (!isObject(data) || data.type !== SDK_RESULT_TYPE) return null
  const { reqId, ok, data: payload, error } = data
  if (typeof reqId !== 'string' || reqId === '' || reqId.length > 64) return null
  if (typeof ok !== 'boolean') return null
  const keys = Object.keys(data)
  if (!keys.every((key) => key === 'type' || key === 'reqId' || key === 'ok' || key === 'data' || key === 'error')) {
    return null
  }
  if (ok) {
    if (keys.includes('error')) return null
    return { type: SDK_RESULT_TYPE, reqId, ok: true, data: payload }
  }
  if (!keys.includes('error') || typeof error !== 'string' || error === '') return null
  return { type: SDK_RESULT_TYPE, reqId, ok: false, error }
}

/** 校验宿主 → runner 的消息（runner 侧同构实现；宿主侧不消费本方向）。 */
export function parseHostToRunnerMessage(data: unknown): HostToRunnerMessage | null {
  if (!isObject(data)) return null
  switch (data.type) {
    case 'agehaos:hello':
      return hasExactKeys(data, ['type']) ? { type: 'agehaos:hello' } : null
    case ECLOSION_CHUNK_TYPE:
      if (!hasExactKeys(data, ['type', 'seq', 'html'])) return null
      if (!isNonNegativeInteger(data.seq) || typeof data.html !== 'string') return null
      return { type: ECLOSION_CHUNK_TYPE, seq: data.seq, html: data.html }
    case ECLOSION_POWER_ON_TYPE:
      if (!hasExactKeys(data, ['type', 'scripts', 'capabilities'])) return null
      if (!isStringArray(data.scripts)) return null
      if (!isSdkCapabilities(data.capabilities)) return null
      return { type: ECLOSION_POWER_ON_TYPE, scripts: data.scripts, capabilities: data.capabilities }
    default:
      return parseSdkResultEnvelope(data)
  }
}

/** 校验 runner → 宿主的消息（§4.1 第 3 条：恰四类，多余字段丢弃，未知类型拒绝）。 */
export function parseRunnerToHostMessage(data: unknown): RunnerToHostMessage | null {
  if (!isObject(data)) return null
  switch (data.type) {
    case 'agehaos:ready':
      return hasExactKeys(data, ['type']) ? { type: 'agehaos:ready' } : null
    case ECLOSION_RENDERED_TYPE:
      return hasExactKeys(data, ['type']) ? { type: 'eclosion:rendered' } : null
    case ECLOSION_ERROR_TYPE:
      if (!hasExactKeys(data, ['type', 'message'])) return null
      if (typeof data.message !== 'string') return null
      return { type: ECLOSION_ERROR_TYPE, message: data.message }
    default: {
      // agehaos:sdk：复用 SDK 桥的白名单解析（api/action/params 严格形状）。
      const request = parseSdkRequest(data)
      return request === null ? null : { type: 'agehaos:sdk', ...request }
    }
  }
}
