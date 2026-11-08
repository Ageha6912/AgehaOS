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

/**
 * 校验 Type B entry 是否在来源 allowlist 内。拒绝外部 URL、路径穿越与非常规写法。
 *
 * 归一化优先（E3 审查）：先按 WHATWG URL 解析再比对——`%2e%2e` 会被浏览器/
 * 服务器按 `..` 处理，字符串检查会漏（`/apps/sites/%2e%2e/runtime/eclosion.html`
 * → `/apps/runtime/eclosion.html`）。query/hash 不属于 Manifest entry（运行时
 * `?v=` 由宿主追加），一律拒绝。
 */
export function isAllowedWebAppEntry(entry: string): boolean {
  if (typeof entry !== 'string' || !entry.startsWith(WEB_APP_ENTRY_PREFIX)) return false
  if (entry.includes('\\') || entry.includes('//')) return false
  // 编码分隔符 / NUL：服务器可能把 %2f、%5c 解码回路径分隔符，绕过段检查。
  if (/%2f|%5c|%00|%3f|%23/i.test(entry)) return false
  let url: URL
  try {
    // 固定 dummy origin：只做路径归一化，不访问网络。
    url = new URL(entry, 'https://ageha.invalid')
  } catch {
    return false
  }
  if (url.origin !== 'https://ageha.invalid') return false
  if (url.search !== '' || url.hash !== '') return false
  // WHATWG 已把编码点段（%2e/%2e%2e）折叠为 . / .. 并消解——这里对归一化后的
  // 路径做同一组检查（含前缀本身：消解后可能已逃出 allowlist 目录）。
  const path = url.pathname
  if (!path.startsWith(WEB_APP_ENTRY_PREFIX) || !path.endsWith('.html')) return false
  const segments = path.slice(WEB_APP_ENTRY_PREFIX.length).split('/')
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
