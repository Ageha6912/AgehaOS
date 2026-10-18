/**
 * 浏览器应用的地址栏解析与代理 URL 构造（可测内核）。
 * 与 server/src/browse/rewrite.ts 的 BROWSE_PATH 是同一字面量的两侧各自实现
 * （spec 表先例：两侧各自钉测试，防一侧漂移）。
 */

/** 代理文档路径（与 server/src/browse/rewrite.ts 同字面量）。 */
export const BROWSE_ENDPOINT = '/api/browse'

/**
 * 默认搜索源：搜狗 Web HTML 端点——中文优先结果；服务端（HK）与本机（华语区）
 * 双区域实测可达且返回静态结果 HTML（结果链接为 sogou /link 重定向，经代理
 * 重写后窗口内直接可达）；DDG 在华语区不可达、Bing 无 JS 只余零星链接，
 * 均落选（2026-10-17 三源代理实测）。
 */
export const SEARCH_ENDPOINT = 'https://www.sogou.com/web'

/** 窗口内 iframe 的代理地址（query 兜底模式）。 */
export function proxyUrlFor(target: string): string {
  return `${BROWSE_ENDPOINT}?url=${encodeURIComponent(target)}`
}

/**
 * 路径态编码（档 ③ 客户端半场；与 server/src/browse/path-codec.ts 同构，
 * 两侧各自测试钉死）：`https://example.com/a?b=1` → `/https/example.com/a?b=1`。
 * 非法输入返回 null（调用方回退 query 模式）。
 */
export function browsePathFor(target: string): string | null {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const path = url.pathname === '' ? '/' : url.pathname
  return `/${url.protocol.slice(0, -1)}/${url.host}${path}${url.search}`
}

/**
 * 子域浏览源（档 ③ 开关）：显式环境优先；生产构建（远程认证）缺省
 * https://browse.ageha.cn；本地开发缺省空串（=禁用 v3，用 query 兜底模式）。
 * 引导失败会自动回退，故 DNS/Caddy 未就绪时该缺省是安全的。
 */
export function resolveBrowseOrigin(
  explicit: string | undefined = import.meta.env.VITE_BROWSE_ORIGIN as string | undefined,
  remoteAuth: boolean = Boolean(import.meta.env.VITE_AUTH_BACKEND),
): string {
  if (typeof explicit === 'string' && explicit !== '') return explicit
  return remoteAuth ? 'https://browse.ageha.cn' : ''
}

export function searchUrlFor(query: string): string {
  return `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}`
}

/** 形如 domain.tld 且无空格无协议：URL 或搜索的判定辅助。 */
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i

export interface AddressIntent {
  kind: 'url' | 'search'
  /** url=补全协议的绝对地址；search=查询词（原样，未编码）。 */
  value: string
}

/**
 * 地址栏输入分类：显式协议 → URL；无空格且形如域名 → 补 https:// 的 URL；
 * 其余（含含空格/中文查询）→ 搜索引擎查询。空串返回 null（不导航）。
 */
export function classifyAddressInput(raw: string): AddressIntent | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (/^https?:\/\//i.test(trimmed)) return { kind: 'url', value: trimmed }
  if (!/\s/.test(trimmed) && DOMAIN_LIKE.test(trimmed)) {
    return { kind: 'url', value: `https://${trimmed}` }
  }
  return { kind: 'search', value: trimmed }
}

/** 地址栏输入 → 最终要打开的目标 URL（url 直取；search 走搜索引擎）。 */
export function targetForInput(raw: string): string | null {
  const intent = classifyAddressInput(raw)
  if (intent === null) return null
  return intent.kind === 'url' ? intent.value : searchUrlFor(intent.value)
}

/** 地址栏显示串：从目标 URL 提取紧凑形态（去协议与尾部斜杠）。 */
export function displayForTarget(target: string): string {
  try {
    const url = new URL(target)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.host}${path}${url.search}`
  } catch {
    return target
  }
}

/** 历史/书签条目显示名：优先 host。 */
export function titleForTarget(target: string): string {
  try {
    return new URL(target).host
  } catch {
    return target
  }
}
