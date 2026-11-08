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

/** 窗口内 iframe 的代理地址（query 兜底模式）。目标里的 hash 移到代理地址
 *  自身的 fragment 上（D1 审查：hash 路由 SPA 与锚点直链——服务端 fetch 自
 *  然剥 fragment，浏览器对 iframe 文档再应用锚点/哈希路由）。 */
export function proxyUrlFor(target: string): string {
  let hash = ''
  let bare = target
  try {
    const url = new URL(target)
    hash = url.hash
    bare = hash === '' ? target : target.slice(0, target.length - hash.length)
  } catch {
    /* 非法 URL 原样走老路径（调用方自行回退） */
  }
  return `${BROWSE_ENDPOINT}?url=${encodeURIComponent(bare)}${hash}`
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
  // 地址栏目标一律写 https 段：https 子域下 http 段会被混合内容拦死（与
  // rewrite.ts 的重写侧升级同口径）。
  const path = url.pathname === '' ? '/' : url.pathname
  // hash 附在路径态地址尾部：浏览器请求服务端时自动剥 fragment，加载后
  // 再对 iframe 文档应用锚点/哈希路由（D1 审查：hash 不再被丢弃）。
  return `/https/${url.host}${path}${url.search}${url.hash}`
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

/**
 * 路径态 → 目标 URL（客户端半场；与 server path-codec.decodeBrowsePath 同构，
 * 测试两侧钉死）：`/https/example.com/a?b=1` → `https://example.com/a?b=1`。
 */
export function targetFromBrowsePath(pathname: string, search: string): string | null {
  const segments = pathname.split('/')
  const scheme = segments[1] ?? ''
  const host = segments[2] ?? ''
  if ((scheme !== 'http' && scheme !== 'https') || host === '') return null
  const rest = segments.slice(3).join('/')
  try {
    const url = new URL(`${scheme}://${host}${rest === '' ? '/' : `/${rest}`}${search}`)
    return url.host === '' ? null : url.toString()
  } catch {
    return null
  }
}

/**
 * iframe 上报的当前位置 → 真实目标 URL（D1 审查）：
 * - query 兜底：同源 `/api/browse?url=…`，取 url 参数；
 * - 路径态：browse 子域 `/https|/http/…`，解码回真实站；
 * - 其余（站外 origin/非代理路径）一律 null。
 */
export function targetFromBrowseUrl(
  reported: string,
  v3Origin: string | null,
  pageOrigin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string | null {
  let url: URL
  try {
    url = new URL(reported, pageOrigin)
  } catch {
    return null
  }
  if (url.origin === pageOrigin && url.pathname === BROWSE_ENDPOINT) {
    const target = url.searchParams.get('url')
    return target !== null && /^https?:\/\//i.test(target) ? target : null
  }
  if (v3Origin !== null) {
    try {
      if (url.origin === new URL(v3Origin).origin) {
        return targetFromBrowsePath(url.pathname, url.search)
      }
    } catch {
      return null
    }
  }
  return null
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
    return `${url.host}${path}${url.search}${url.hash}`
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
