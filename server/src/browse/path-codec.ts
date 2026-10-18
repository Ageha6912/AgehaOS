/**
 * 路径态 URL 编码（档 ③）：目标 URL ⇄ `/https/example.com/a/b?c=1`。
 * 首段固定 http|https（与固定路由 /raw、/sw.js、/api、/__* 天然不撞），
 * 第二段 host[:port]，其余为 pathname（percent 编码原样保留）+ search。
 *
 * 路径态是子域浏览模式的地基：
 * - 文档链接/表单 action 用它（SW 缺席时直连也可渲染——首访路径）；
 * - SW 把页面内相对请求映射回 /raw + 路径态（防递归前缀见 sw-source）。
 */

const BROWSE_SCHEME_SEGMENTS = new Set(['http', 'https'])

/** 目标 URL → 路径态（非法/非 http(s) → null）。 */
export function encodeBrowsePath(target: string): string | null {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  const scheme = url.protocol.slice(0, -1)
  if (!BROWSE_SCHEME_SEGMENTS.has(scheme)) return null
  const path = url.pathname === '' ? '/' : url.pathname
  return `/${scheme}/${url.host}${path}${url.search}`
}

/** 路径态 → 目标 URL（归一化点段；非法 → null）。 */
export function decodeBrowsePath(pathname: string, search: string): string | null {
  const segments = pathname.split('/')
  const scheme = segments[1] ?? ''
  const host = segments[2] ?? ''
  if (!BROWSE_SCHEME_SEGMENTS.has(scheme) || host === '') return null
  const rest = segments.slice(3).join('/')
  const path = rest === '' ? '/' : `/${rest}`
  try {
    const url = new URL(`${scheme}://${host}${path}${search}`)
    if (url.host === '') return null
    return url.toString()
  } catch {
    return null
  }
}

/** pathname 是否路径态（首段为 scheme）。 */
export function isBrowsePath(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? ''
  return BROWSE_SCHEME_SEGMENTS.has(first)
}
