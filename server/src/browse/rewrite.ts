/**
 * 浏览代理的 HTML 重写（无解析器依赖的正则档）：
 * - 注入 `<base href="最终URL">`（资产/CSS url() 仍从原站加载，文档本体走代理）；
 * - 把 `<a>/<area>` 的 href 与 GET `<form>` 的 action 重写为代理路径——站内
 *   跳转也经代理回流，否则 iframe 一跳回真站就撞 X-Frame-Options；
 * - 既有的 `<base>` 一律移除（防重定向到未经闸的地址）。
 * 已知取舍：POST 表单不重写（登录/搜索提交直接跳真站，属「SPA/登录态退化档」）；
 * 属性值里含 `>` 的畸形标签不覆盖（正则档被接受的上限）。
 */

/** 代理文档路径（客户端 iframe 与重写共用同一字面量，两侧测试各自钉死）。 */
export const BROWSE_PATH = '/api/browse'

export function buildBrowseUrl(target: string): string {
  return `${BROWSE_PATH}?url=${encodeURIComponent(target)}`
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

const NON_NAVIGABLE_PREFIXES = ['javascript:', 'mailto:', 'tel:', 'data:', 'blob:', 'about:']

function rewriteHrefValue(value: string, base: URL): string | null {
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
  return buildBrowseUrl(target.toString())
}

const URL_ATTRIBUTE = /\b(href|action)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const ANCHOR_TAGS = /<(a|area)\b([^>]*)>/gi
const FORM_TAGS = /<form\b([^>]*)>/gi
const METHOD_ATTRIBUTE = /\bmethod\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-z]+))/i
const BASE_TAG = /<base\b[^>]*>/gi
const HEAD_OPEN = /<head[^>]*>/i
const HTML_OPEN = /<html[^>]*>/i

export function rewriteHtml(html: string, finalUrl: string): string {
  const base = new URL(finalUrl)
  let out = html.replace(BASE_TAG, '')
  out = out.replace(ANCHOR_TAGS, (_whole: string, tag: string, attrs: string) => {
    const replaced = attrs.replace(
      URL_ATTRIBUTE,
      (match: string, attr: string, dq?: string, sq?: string) => {
        if (attr.toLowerCase() !== 'href') return match
        const rewritten = rewriteHrefValue(dq ?? sq ?? '', base)
        return rewritten === null ? match : `href="${escapeAttr(rewritten)}"`
      },
    )
    return `<${tag}${replaced}>`
  })
  out = out.replace(FORM_TAGS, (whole: string, attrs: string) => {
    const methodMatch = METHOD_ATTRIBUTE.exec(attrs)
    const method = (methodMatch?.[1] ?? methodMatch?.[2] ?? methodMatch?.[3] ?? 'get').toLowerCase()
    if (method === 'post') return whole
    const replaced = attrs.replace(
      URL_ATTRIBUTE,
      (match: string, attr: string, dq?: string, sq?: string) => {
        if (attr.toLowerCase() !== 'action') return match
        const rewritten = rewriteHrefValue(dq ?? sq ?? '', base)
        return rewritten === null ? match : `action="${escapeAttr(rewritten)}"`
      },
    )
    return `<form${replaced}>`
  })
  const inject = `<base href="${escapeAttr(base.toString())}">`
  if (HEAD_OPEN.test(out)) out = out.replace(HEAD_OPEN, (match) => `${match}${inject}`)
  else if (HTML_OPEN.test(out)) out = out.replace(HTML_OPEN, (match) => `${match}${inject}`)
  else out = inject + out
  return out
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
  const targetLine = target === '' ? '' : `<p class="url">${escapeAttr(target)}</p>`
  const actions = [
    target === ''
      ? ''
      : `<a class="btn primary" href="${escapeAttr(target)}" target="_blank" rel="noopener noreferrer">在新标签页打开</a>`,
    options.retryHref === undefined
      ? ''
      : `<a class="btn" href="${escapeAttr(options.retryHref)}">重试</a>`,
  ].join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeAttr(options.title)}</title>
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
<h1>${escapeAttr(options.title)}</h1>
<p>${escapeAttr(options.message)}</p>
${targetLine}
<p>${actions}</p>
</main></body></html>`
}
