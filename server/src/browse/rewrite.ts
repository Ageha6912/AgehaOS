import { encodeBrowsePath } from './path-codec'
import { browseClickGuardTag, browseNavReportTag, browsePreludeTag } from './prelude'

/**
 * 浏览代理的 HTML 重写（无解析器依赖的正则档）：
 * - 注入 `<base href="最终URL">`（资产/CSS url() 仍从原站加载，文档本体走代理）；
 * - 把 `<a>/<area>` 的 href 与 `<form>` 的 action（GET 与 POST 一视同仁）
 *   重写为代理路径——站内跳转与表单提交都经代理回流，否则 iframe 一跳回
 *   真站就撞 X-Frame-Options；POST 的 method/enctype 原样保留（代理路由
 *   按原始字节转发，multipart 边界不破坏）。
 * - 既有的 `<base>` 一律移除（防重定向到未经闸的地址）。
 * 链接产出两种形态（linkStyle）：
 * - 'query'（兜底模式）：/api/browse?url=…（不透明 origin 沙箱下可用）；
 *   **注入 <base href=目标>**——该模式下无 SW 接管请求，资产/相对 URL 必须
 *   直连原站。
 * - 'path'（档 ③ 子域模式）：/https/host/path 相对路径；**不注入 base**——
 *   页面相对 URL（含 JS 相对 fetch/XHR）按文档真实地址（browse 路径态）解析，
 *   经 SW → /raw → 服务端（资产字节透传）；注入 base 会把页面 JS 的相对请求
 *   劫持到真实站点（跨域 CORS 全灭，2026-10-18 冒烟实证）。同时注入存储
 *   命名空间前奏。
 *
 * 已知取舍：属性值里含 `>` 的畸形标签不覆盖（正则档被接受的上限）。
 */

export type LinkStyle = 'query' | 'path'

/** 代理文档路径（客户端 iframe 与重写共用同一字面量，两侧测试各自钉死）。 */
export const BROWSE_PATH = '/api/browse'

/**
 * 代理文档 URL。`proxyOrigin` 非空时产出**绝对地址**：query 兜底模式注入的
 * `<base>` 指向真实站点，路径绝对 URL 会按 base 的 origin 解析（实测
 * `/api/browse` → 真实站 `/api/browse`），链接/表单必须带代理 origin 才能
 * 回流（2026-11 审查 A2 连带实证）。
 */
export function buildBrowseUrl(target: string, proxyOrigin = ''): string {
  return `${proxyOrigin}${BROWSE_PATH}?url=${encodeURIComponent(target)}`
}

/**
 * HTML 文本/属性通用转义。文本位必须转义 `<`/`>`（否则目标 URL 里的
 * `<img onerror=...>` 会被浏览器当标签执行）；属性位同时转义引号。
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}

const NON_NAVIGABLE_PREFIXES = ['javascript:', 'mailto:', 'tel:', 'data:', 'blob:', 'about:']

function rewriteHrefValue(
  value: string,
  base: URL,
  linkStyle: LinkStyle,
  proxyOrigin = '',
): string | null {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const lower = trimmed.toLowerCase()
  if (NON_NAVIGABLE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null
  let target: URL
  try {
    target = new URL(trimmed, base)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  // 混合内容防护（2026-10-18 B 站实证）：文档在 https 子域，页面里的**协议
  // 相对链接** `//host/x` 会被浏览器解析成 http——原样编码成 /http/... 会被
  // 按混合内容拦成 chrome-error。只升级这一类（原文以 // 开头）；显式
  // `http://` 链接保持真实协议（服务端原样请求，避免把不支持 https 的站点打死）。
  if (trimmed.startsWith('//') && target.protocol === 'http:') target.protocol = 'https:'
  return linkStyle === 'path'
    ? (encodeBrowsePath(target.toString()) ?? buildBrowseUrl(target.toString(), proxyOrigin))
    : buildBrowseUrl(target.toString(), proxyOrigin)
}

/**
 * GET 表单目标隐藏域名（query 兜底模式）：浏览器提交 GET 表单时会把
 * action 的 query 整体替换成表单数据，目标 URL 只能放进表单域；路由读到
 * 本字段后把其余查询参数（表单字段）追加到目标 URL（与原站 GET 语义一致）。
 */
export const BROWSE_FORM_TARGET_FIELD = '__ageha_url'

/**
 * 属性 token 化（名称 + 可选值，支持双引号/单引号/无引号）：先整体吃掉
 * 「值」，值内部的 `href="…"` 字样不会被下一轮误认成属性（2026-11 审查：
 * `data-href` 因 `-` 是词边界被 `\b(href|action)` 误命中；属性值内的 href
 * 字样同样被改写）。
 */
const ATTRIBUTE_TOKEN = /([^\s=/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g

/** 只改写指定属性（名小写比对）；返回 null 表示保留原文。 */
function rewriteAttributes(
  attrs: string,
  rewrite: (name: string, value: string) => string | null,
): string {
  return attrs.replace(
    ATTRIBUTE_TOKEN,
    (match: string, name: string, equals: string, dq?: string, sq?: string, uq?: string) => {
      const rewritten = rewrite(name.toLowerCase(), dq ?? sq ?? uq ?? '')
      return rewritten === null ? match : `${name.toLowerCase()}${equals}"${escapeAttr(rewritten)}"`
    },
  )
}

/** 读取第一个同名属性值（token 化，取不到回 null）。 */
function readAttribute(attrs: string, wanted: string): string | null {
  for (const match of attrs.matchAll(ATTRIBUTE_TOKEN)) {
    if (match[1].toLowerCase() === wanted) return match[3] ?? match[4] ?? match[5] ?? ''
  }
  return null
}

/**
 * 表单目标解析（HTML 表单提交语义）：空 action / 仅 fragment 指向当前文档；
 * 其余按解析基准求绝对 http(s) 地址。非可导航 scheme → null（保持原样）。
 */
function resolveFormTarget(actionValue: string | null, base: URL): URL | null {
  const trimmed = actionValue?.trim() ?? ''
  if (trimmed === '') return new URL(base.toString())
  if (trimmed.startsWith('#')) {
    const target = new URL(base.toString())
    target.hash = trimmed.slice(1)
    return target
  }
  const lower = trimmed.toLowerCase()
  if (NON_NAVIGABLE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null
  try {
    const target = new URL(trimmed, base)
    return target.protocol === 'http:' || target.protocol === 'https:' ? target : null
  } catch {
    return null
  }
}

const ANCHOR_TAGS = /<(a|area)\b([^>]*)>/gi
const FORM_TAGS = /<form\b([^>]*)>/gi
/** button/input 的 formaction 提交目标（表单级 action 的元素级覆盖）。 */
const BUTTON_ACTION_TAGS = /<(button|input)\b([^>]*)>/gi
const BASE_TAG = /<base\b([^>]*)>/gi
const HEAD_OPEN = /<head[^>]*>/i
const HTML_OPEN = /<html[^>]*>/i

/**
 * rawtext/注释区段（A2 审查实测：`<script>var t='<a href="/x">'</script>`
 * 的 JS 字符串、样式与注释里的 href= 字样都会被当标记改写，产出残句）：
 * 遮蔽 → 全部改写 → 原样放回。闭合区段与「开标签直到 EOF」（浏览器 rawtext
 * 语义：无闭合标签时正文吃到文档尾）都覆盖。
 */
const RAW_SEGMENT = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const UNCLOSED_RAW_OPEN = /<(?:script|style)\b[^>]*>/gi
/** 遮蔽哨兵：NUL 前后缀 + 段号；正常页面不含 NUL（含 NUL 的畸形页由换号避撞）。 */
// eslint-disable-next-line no-control-regex -- NUL 边界正是哨兵设计的一部分
const SENTINEL_PATTERN = /\u0000AXSEG(\d+)\u0000/g

function maskRawSegments(html: string): { masked: string; segments: string[] } {
  const segments: string[] = []
  const mask = (segment: string): string => {
    for (;;) {
      const sentinel = `\u0000AXSEG${segments.length}\u0000`
      if (!html.includes(sentinel)) {
        segments.push(segment)
        return sentinel
      }
      segments.push('') // 编号让位：真实页面文本占住了这个哨兵形态
    }
  }
  let masked = ''
  let last = 0
  for (const match of html.matchAll(RAW_SEGMENT)) {
    const start = match.index ?? 0
    masked += html.slice(last, start) + mask(match[0])
    last = start + match[0].length
  }
  masked += html.slice(last)
  // 未闭合 script/style：闭合区段已全部遮蔽，剩余的首个开标签到 EOF 都是正文。
  for (const match of masked.matchAll(UNCLOSED_RAW_OPEN)) {
    const start = match.index ?? 0
    masked = masked.slice(0, start) + mask(masked.slice(start))
    break
  }
  return { masked, segments }
}

function unmaskRawSegments(html: string, segments: readonly string[]): string {
  return html.replace(SENTINEL_PATTERN, (_whole, index: string) => segments[Number(index)] ?? '')
}

/** 原页 `<base>` 的解析基准与默认 target（HTML 规范：首个 href / 首个 target）。 */
interface BaseInfo {
  href: URL | null
  target: string | null
}

function extractBase(html: string, finalUrl: URL): BaseInfo {
  let href: URL | null = null
  let target: string | null = null
  for (const match of html.matchAll(BASE_TAG)) {
    const attrs = match[1] ?? ''
    if (href === null) {
      const value = readAttribute(attrs, 'href')?.trim()
      if (value !== undefined && value !== '') {
        try {
          const candidate = new URL(value, finalUrl)
          if (candidate.protocol === 'http:' || candidate.protocol === 'https:') href = candidate
        } catch {
          /* 非法 base href：忽略，退回文档最终地址 */
        }
      }
    }
    if (target === null) {
      const value = readAttribute(attrs, 'target')?.trim()
      if (value !== undefined && value !== '') target = value
    }
  }
  return { href, target }
}

/**
 * GET 表单改写：query 模式把目标放进隐藏域 + action 指向裸 /api/browse
 * （action 的 query 会被浏览器整体替换成表单数据，绝不能承载目标）；路径
 * 模式 action 保留目标路径——query 被替换后正好是目标站点该收到的表单
 * 数据，与原站原生行为一致。POST 保持原口径（body 原样转发）。
 */
function rewriteFormTag(
  attrs: string,
  base: URL,
  linkStyle: LinkStyle,
  proxyOrigin: string,
): string {
  const method = (readAttribute(attrs, 'method') ?? 'get').trim().toLowerCase()
  if (method !== 'get') {
    return `<form${rewriteAttributes(attrs, (name, value) =>
      name === 'action' ? rewriteHrefValue(value, base, linkStyle, proxyOrigin) : null,
    )}>`
  }
  const resolved = resolveFormTarget(readAttribute(attrs, 'action'), base)
  if (resolved === null) return `<form${rewriteAttributes(attrs, () => null)}>`
  const proxyAction =
    linkStyle === 'path'
      ? (encodeBrowsePath(resolved.toString()) ??
        buildBrowseUrl(resolved.toString(), proxyOrigin))
      : `${proxyOrigin}${BROWSE_PATH}`
  const replaced = rewriteAttributes(attrs, (name) => (name === 'action' ? proxyAction : null))
  // 无 action 属性时补一个（GET 的默认 action = 当前代理文档 URL，query 会
  // 被表单数据替换，目标同样丢失）。
  const withAction =
    readAttribute(attrs, 'action') === null
      ? `${replaced} action="${escapeAttr(proxyAction)}"`
      : replaced
  const marker =
    linkStyle === 'path'
      ? ''
      : `<input type="hidden" name="${BROWSE_FORM_TARGET_FIELD}" value="${escapeAttr(resolved.toString())}">`
  return `<form${withAction}>${marker}`
}

export interface RewriteOptions {
  /** 链接产出形态（缺省 query=兜底模式）。 */
  linkStyle?: LinkStyle
  /**
   * 代理自身 origin（如 `https://os.ageha.cn`）：query 模式改写产出绝对
   * URL 用——注入的 `<base>` 指向真实站点，路径绝对链接会被 base origin
   * 劫持到真站；路径模式不需要（相对路径即代理同源）。
   */
  proxyOrigin?: string
}

export function rewriteHtml(html: string, finalUrl: string, options: RewriteOptions = {}): string {
  const linkStyle = options.linkStyle ?? 'query'
  const proxyOrigin = options.proxyOrigin ?? ''
  const documentUrl = new URL(finalUrl)
  // 先遮蔽 script/style/注释区段（正文里的 href=/action= 是代码不是标记）；
  // `<base>` 的解析/删除也在遮蔽后做——JS 字符串里的 base 不再污染解析基准。
  const { masked, segments } = maskRawSegments(html)
  const documentBase = extractBase(masked, documentUrl)
  const base = documentBase.href ?? documentUrl
  let out = masked.replace(BASE_TAG, '')
  out = out.replace(ANCHOR_TAGS, (_whole: string, tag: string, attrs: string) => {
    const replaced = rewriteAttributes(attrs, (name, value) =>
      name === 'href' ? rewriteHrefValue(value, base, linkStyle, proxyOrigin) : null,
    )
    return `<${tag}${replaced}>`
  })
  out = out.replace(FORM_TAGS, (_whole: string, attrs: string) =>
    rewriteFormTag(attrs, base, linkStyle, proxyOrigin),
  )
  // button/input 的 formaction（A2 审查）：与 action 同口径重写，query 模式
  // 产出绝对代理 URL。已知边界：query 模式 GET 表单里经 formaction 提交时
  // 表单字段不会并入目标（隐藏域只覆盖 form 级 action 的提交路径）。
  out = out.replace(BUTTON_ACTION_TAGS, (_whole: string, tag: string, attrs: string) => {
    const replaced = rewriteAttributes(attrs, (name, value) =>
      name === 'formaction' ? rewriteHrefValue(value, base, linkStyle, proxyOrigin) : null,
    )
    return `<${tag}${replaced}>`
  })
  // 点击守卫两种模式都注入（弹窗/顶层导航在沙箱里均不可靠，见 prelude 注释）；
  // 档 ③ 路径模式不注入真实站 base（相对 URL 归 SW/服务端回转），但原页
  // `<base href>` 存在时注入**代理路径**形态的等价 base（相对 URL 仍落回
  // 同源代理，不跨到真实站点）；query 模式注入解析后的真实 base（无 SW 接管，
  // 资产与相对 URL 直连原站——见文件头说明）。`<base target>` 一并保留。
  const baseParts: string[] = []
  if (documentBase.href !== null) {
    if (linkStyle === 'path') {
      const proxyBase = encodeBrowsePath(documentBase.href.toString())
      if (proxyBase !== null) baseParts.push(`href="${escapeAttr(proxyBase)}"`)
    } else {
      baseParts.push(`href="${escapeAttr(documentBase.href.toString())}"`)
    }
  } else if (linkStyle === 'query') {
    baseParts.push(`href="${escapeAttr(documentUrl.toString())}"`)
  }
  if (documentBase.target !== null) {
    baseParts.push(`target="${escapeAttr(documentBase.target)}"`)
  }
  const baseTag = baseParts.length === 0 ? '' : `<base ${baseParts.join(' ')}>`
  const inject =
    linkStyle === 'path'
      ? `${browseClickGuardTag()}${browseNavReportTag()}${browsePreludeTag()}${baseTag}`
      : `${browseClickGuardTag()}${browseNavReportTag()}${baseTag}`
  if (HEAD_OPEN.test(out)) out = out.replace(HEAD_OPEN, (match) => `${match}${inject}`)
  else if (HTML_OPEN.test(out)) out = out.replace(HTML_OPEN, (match) => `${match}${inject}`)
  else out = inject + out
  // 遮蔽区段原样放回（改写只发生在区段之外）。
  return unmaskRawSegments(out, segments)
}

/**
 * 字符集探测：响应头 charset 优先，其次 HTML 头部 <meta charset> 猜（前
 * 2048 字节 latin1 扫），缺省 utf-8。截流侧一律按探测结果解码后重编码为
 * UTF-8 输出（中文站仍常见 gbk/gb18030）。
 */
export function detectCharset(buffer: Uint8Array, headerContentType: string | null): string {
  const headerCharset =
    headerContentType === null
      ? null
      : (/charset\s*=\s*"?([\w-]+)"?/i.exec(headerContentType)?.[1] ?? null)
  if (headerCharset !== null) return headerCharset
  const head = new TextDecoder('latin1').decode(buffer.subarray(0, 2048))
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8'
}

export function decodeWithCharset(buffer: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/**
 * 浏览错误页（代理侧 UI）：站点打不开时 iframe 里呈现的兜底面板——
 * 错误码 + 目标地址 + 「在新标签页打开」（真实站点在顶层标签不受任何
 * 嵌入限制）+ 「重试」链接。样式内联，不依赖宿主。
 */
export function browseErrorPage(options: {
  title: string
  message: string
  targetUrl?: string
  retryHref?: string
}): string {
  const target = options.targetUrl ?? ''
  const targetLine = target === '' ? '' : `<p class="url">${escapeHtml(target)}</p>`
  const actions = [
    target === ''
      ? ''
      : `<a class="btn primary" href="${escapeAttr(target)}" target="_blank" rel="noopener noreferrer">在新标签页打开</a>`,
    options.retryHref === undefined
      ? ''
      : `<a class="btn" href="${escapeAttr(options.retryHref)}">重试</a>`,
  ].join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title>
<style>
body{margin:0;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:transparent;color:#475569;display:flex;align-items:center;justify-content:center;min-height:100vh}
main{max-width:26rem;padding:2rem;text-align:center}
h1{font-size:1rem;margin:0 0 .5rem;color:#0f172a}
p{margin:0 0 1rem}
.url{font-family:ui-monospace,monospace;font-size:12px;word-break:break-all;color:#64748b;background:rgba(100,116,139,.08);padding:.5rem .75rem;border-radius:.5rem}
.btn{display:inline-flex;align-items:center;justify-content:center;margin:0 .25rem;padding:.5rem 1rem;border-radius:.5rem;border:1px solid rgba(100,116,139,.35);color:#334155;text-decoration:none;font-size:13px}
.btn.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
@media (prefers-color-scheme: dark){body{color:#94a3b8}h1{color:#e2e8f0}.btn{color:#cbd5e1;border-color:rgba(148,163,184,.35)}.url{color:#94a3b8;background:rgba(148,163,184,.1)}}
</style></head>
<body><main>
<h1>${escapeHtml(options.title)}</h1>
<p>${escapeHtml(options.message)}</p>
${targetLine}
<p>${actions}</p>
</main></body></html>`
}
