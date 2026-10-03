/**
 * Type B Web App 宿主策略与协议（PRD §8.1 Type B、§30.3、docs/SECURITY.md）。
 *
 * 隔离模型（三层，缺一不可）：
 * 1. **来源 allowlist**：entry 只允许打包在同一origin `/apps/sites/` 下的静态
 *    HTML——外部 URL 一律拒绝（生产 CSP `frame-src 'self'` 是第二道闸）。
 * 2. **iframe sandbox**：`allow-scripts` 且**不**给 `allow-same-origin`——
 *    应用运行在不透明 origin，拿不到父页面 DOM、cookie 与 localStorage。
 * 3. **postMessage 校验**：宿主只接受 `event.source === iframe.contentWindow`
 *    且通过白名单 schema 校验的消息；未知类型与多余字段一律丢弃。
 *
 * 本模块为纯函数/常量（core 框架无关），React 宿主容器在 components/web-app-frame。
 */

/** 打包式 Web App 的唯一合法 entry 前缀（同源静态站点）。 */
export const WEB_APP_ENTRY_PREFIX = '/apps/sites/'

/**
 * 羽化运行时的唯一合法 entry（AI-GENERATED-APPS-DESIGN §3.2）：羽化宿主
 * （EclosionAppFrame）只接受这一个精确值。它**不在** `/apps/sites/` allowlist 内，
 * 两套判定互不放宽；缓存破围的 `?v=` 查询参数由宿主在渲染 iframe 时追加，
 * 不属于 Manifest entry 的一部分。
 */
export const ECLOSION_RUNNER_ENTRY = '/apps/runtime/eclosion.html'

/**
 * sandbox 属性：允许脚本但保持不透明 origin。
 * 绝不添加 `allow-same-origin` / `allow-top-navigation` / `allow-popups`。
 */
export const WEB_APP_SANDBOX = 'allow-scripts'

/** 应用 → 宿主就绪消息（握手第二步，宿主在 iframe load 后先发 hello）。 */
export const APP_READY_TYPE = 'agehaos:ready'
/** 宿主 → 应用握手消息。 */
export interface HostHelloMessage {
  type: 'agehaos:hello'
}

/** 校验 Type B entry 是否在来源 allowlist 内。拒绝外部 URL、路径穿越与非常规写法。 */
export function isAllowedWebAppEntry(entry: string): boolean {
  if (typeof entry !== 'string' || !entry.startsWith(WEB_APP_ENTRY_PREFIX)) return false
  if (entry.includes('\\') || entry.includes('//')) return false
  if (!entry.endsWith('.html')) return false
  const segments = entry.slice(WEB_APP_ENTRY_PREFIX.length).split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * 羽化宿主 entry 判定（§3.2）：只接受与 ECLOSION_RUNNER_ENTRY **精确相等** 的值——
 * 不做前缀匹配、不接受查询串/穿越变体，防止 `…/eclosion.html/../x.html` 类构造。
 */
export function isEclosionRunnerEntry(entry: string): boolean {
  return entry === ECLOSION_RUNNER_ENTRY
}

/** 宿主 → 应用的握手消息（冻结常量，直接 postMessage）。 */
export function hostHelloMessage(): HostHelloMessage {
  return Object.freeze({ type: 'agehaos:hello' })
}

export type ParsedAppMessage = { type: 'agehaos:ready' }

/**
 * 校验来自沙箱应用的 postMessage 数据。白名单类型 + 严格形状；
 * 任何多余字段、错误类型都返回 null（丢弃，而不是宽松解析）。
 */
export function parseAppMessage(data: unknown): ParsedAppMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'type') return null
  if (raw.type === APP_READY_TYPE) return { type: 'agehaos:ready' }
  return null
}
