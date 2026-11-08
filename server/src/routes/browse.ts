import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  capJarBytes,
  cookiesForOrigin,
  mergeSetCookies,
  originOf,
  parseJar,
  serializeJar,
} from '../browse/cookie-jar'
import {
  BROWSE_COOKIE,
  BROWSE_GRANT_TTL_MS,
  CLAIM_TOKEN_TTL_MS,
  signGrant,
  verifyGrant,
} from '../browse/grant'
import { decodeBrowsePath, encodeBrowsePath } from '../browse/path-codec'
import { assertPublicUrl, BrowsePolicyError, type ResolveHost } from '../browse/url-policy'
import {
  browseErrorPage,
  decodeWithCharset,
  detectCharset,
  rewriteHtml,
  buildBrowseUrl,
  BROWSE_FORM_TARGET_FIELD,
  type LinkStyle,
} from '../browse/rewrite'
import { browseSwSource } from '../browse/sw-source'
import type { DataStore } from '../store/types'
import { SESSION_COOKIE } from './auth'

/**
 * 浏览器代理（/api/browse?url=...）：服务端取回目标页面，剥掉禁止嵌入的
 * 响应头，把文档重写为经代理回流后同源供给窗口内 iframe。
 *
 * 安全契约：
 * - 会话门（未登录 401）+ 每会话限流（文档级 120/min——资产仍从原站直载，
 *   不经代理，所以网页浏览的文档请求量不大）；
 * - SSRF：目标与每一跳重定向都过 assertPublicUrl（公网 http/https、
 *   默认端口、域名全量 A/AAAA 必须公网）；
 * - 头消毒：不转发**客户端** Cookie/Referer 到上游（AgehaOS 会话 cookie 永不
 *   出站）；上游 Set-Cookie 不回流浏览器、进服务端 Cookie 罐（按用户 × 目标
 *   源隔离，逐跳吸收/附加），窗口内解锁登录态；值仅存服务端、永不进日志；
 * - 资源上限：超时 12s 中止、响应体 5MB 封顶（超限 413 错误页）、POST
 *   请求体 12MB 封顶（表单上传）；
 * - HTML 一律按探测字符集解码后重编码 UTF-8 输出（gbk 中文站不再乱码），
 *   并被注入 <base> + 链接重写；非 HTML（图片/PDF 等）按字节透传；
 * - POST（表单向代理提交，沙箱 iframe 的 `Origin: null` 经路由级豁免放行，
 *   会话门 + SameSite=Lax 双保）以原始字节转发上游；重定向方法规则按
 *   HTTP 语义（303 与 301/302-on-POST 转 GET，307/308 保方法保体）。
 *
 * 档 ③（子域 + Service Worker，2026-10-18）：三条入口共用同一代理主体——
 * `/api/browse?url=`（query 兜底模式）、`/https/*` `/http/*`（路径态文档，SW
 * 缺席时直连也可渲染）、`/raw/*`（SW 数据通道，SW 把子域内一切请求换算至此）。
 * 路径态重写产出相对链接（`/https/host/path`）并注入存储命名空间前奏；
 * 子域鉴权：主域会话 cookie（os 域）或子域 browse grant（由 `/__claim`
 * 以主域签发的短期令牌换取，httpOnly、值仅承载 userId 与过期时间）；
 * `/sw.js` 与 `/__bootstrap` 为子域自举资源（SW 源码薄层，逻辑全在服务端）。
 *
 * 退化预期（档 C 口径）：静态/半静态站点体验良好；SPA 交互、强风控站点
 * 会在错误页给出「在新标签页打开」的真实浏览兜底。
 */

const BROWSE_TIMEOUT_MS = 12_000
const BROWSE_MAX_BYTES = 5 * 1024 * 1024
/** POST 请求体（表单/文件上传）上限。 */
const BROWSE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024
const BROWSE_MAX_REDIRECTS = 5

const UPSTREAM_HEADERS: Readonly<Record<string, string>> = {
  // 以普通桌面浏览器身份取页（部分站点对默认 UA 直接 403）。
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * 子域引导页（档 ③）：读 hash 令牌 → /__claim 换取子域 httpOnly cookie →
 * 注册 /sw.js 并等接管（controllerchange，3s 兜底）→ postMessage 通知主域
 * 外壳（只含 ok 布尔）。内联脚本依赖路由级 CSP 关闭（routeOptions）。
 */
const BOOTSTRAP_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>AgehaOS 浏览器引导</title></head><body>
<p style="font:13px/1.6 system-ui,sans-serif;color:#64748b;padding:12px">正在准备窗口内浏览…</p>
<script>
(async function () {
  function notify(ok) {
    try { parent.postMessage({ type: 'agehaos:browse-ready', ok: ok }, '*') } catch (e) {}
  }
  try {
    var token = decodeURIComponent((location.hash || '').replace(/^#t=/, ''));
    if (token) {
      var claimed = await fetch('/__claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token })
      });
      if (!claimed.ok) { notify(false); return; }
    }
    if (!('serviceWorker' in navigator)) { notify(false); return; }
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    // 等注册进入 active（serviceWorker.ready）再放行——否则外壳立即导航时
    // SW 可能仍在 activating，首个文档不受控（相对请求不进 /raw）。
    var ready = false;
    await Promise.race([
      navigator.serviceWorker.ready.then(function () { ready = true; }),
      new Promise(function (resolve) { setTimeout(resolve, 5000); })
    ]);
    if (!ready) { notify(false); return; }
    if (!navigator.serviceWorker.controller) {
      await new Promise(function (resolve) {
        var timer = setTimeout(resolve, 3000);
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          clearTimeout(timer); resolve();
        }, { once: true });
      });
    }
    notify(true);
  } catch (e) { notify(false); }
})();
</script></body></html>`

export interface BrowseRoutesOptions {
  store: DataStore
  rateLimitWindowMs: number
  /** 测试注入：替换 fetch / DNS / 上限 / 放行端口集。 */
  fetcher?: typeof fetch
  resolveHost?: ResolveHost
  timeoutMs?: number
  maxBytes?: number
  allowedPorts?: ReadonlySet<string>
  /**
   * 本地开发开关：放行 198.18.0.0/15 基准段（TUN fake-IP）。缺省读
   * AGEHA_BROWSE_TRUST_FAKE_IP=1；生产不设该变量即恒关。
   */
  allowBenchmarkRange?: boolean
  /** 子域授权令牌签名密钥（app 装配使用独立随机 browseSecret；测试可直接给常量）。 */
  tokenSecret?: string
  /** 子域 browse cookie 的 Secure 标志（生产 true；本地 http 为 false）。 */
  cookieSecure?: boolean
  /** 允许嵌入子域文档的站点源（frame-ancestors 追加项；app 装配注入主域）。 */
  frameAncestors?: readonly string[]
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null
  const reader = response.body?.getReader()
  if (reader === undefined) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export async function browseRoutes(
  app: FastifyInstance,
  options: BrowseRoutesOptions,
): Promise<void> {
  const { store } = options
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? BROWSE_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? BROWSE_MAX_BYTES
  const policyOptions = {
    resolveHost: options.resolveHost,
    allowedPorts: options.allowedPorts,
    // 生产无此环境变量 → 恒 false；本地 TUN（fake-IP）开发时置 1。
    allowBenchmarkRange:
      options.allowBenchmarkRange ?? process.env.AGEHA_BROWSE_TRUST_FAKE_IP === '1',
  }

  const tokenSecret = options.tokenSecret ?? 'dev-browse-secret'
  const cookieSecure = options.cookieSecure ?? true
  /** 子域文档的嵌入白名单（替代 XFO）：仅允许 OS 主域/本地回环嵌入。
   *  刻意不含 'self'——档 ③ 是单一 browse origin，若允许自嵌，任何被代理
   *  页面都能 `<iframe src="/https/victim/">` 后同源读 DOM（跨站窃取）。
   *  合法嵌入方只有 OS 主域（os.ageha.cn / localhost / 配置来源）。 */
  const frameAncestorsPolicy = [
    'frame-ancestors',
    'http://localhost:*',
    'http://127.0.0.1:*',
    ...(options.frameAncestors ?? []),
  ].join(' ')

  /**
   * 错误页专用 CSP：代理错误页只含静态文案与链接，禁止一切脚本/插件；
   * 内联样式由页面自带，需 style-src 'unsafe-inline'。错误响应里可能反射
   * 用户可控的目标 URL，脚本闸是转义之外的第二道防线。
   */
  const ERROR_PAGE_CSP = `${frameAncestorsPolicy}; script-src 'none'; object-src 'none'; style-src 'unsafe-inline'`

  /**
   * query 兜底模式（主域 /api/browse）的文档 CSP：追加 sandbox（不含
   * allow-same-origin）——与客户端兜底 iframe 的 SANDBOX_FALLBACK 同口径。
   * 即使该 URL 被顶层打开，文档也落不透明 origin，拿不到主域会话凭据与
   * 同源 /api 读取能力；路径态（browse 子域）依赖 allow-same-origin，不能加。
   */
  const QUERY_SANDBOX_CSP = `${frameAncestorsPolicy}; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads`

  const unauthorized = (reply: FastifyReply, message: string): null => {
    void reply
      .code(401)
      .type('text/html; charset=utf-8')
      .header('content-security-policy', ERROR_PAGE_CSP)
      .send(browseErrorPage({ title: '需要登录', message }))
    return null
  }

  /**
   * 会话门（双通道，档 ③）：
   * ① 主域会话 cookie（os 域请求；sync/eclosion 同范式）；
   * ② 子域 browse grant（browse 域请求；由 /__claim 换取，HMAC 验签）。
   * 未登录给 HTML 错误页（iframe 里可读）；通过返回 userId（Cookie 罐隔离）。
   */
  const requireUser = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> => {
    const token = request.cookies[SESSION_COOKIE]
    if (token !== undefined) {
      const session = await store.findSession(token)
      if (!session || session.expiresAt <= Date.now()) {
        return unauthorized(reply, '会话已过期，请重新登录。')
      }
      return session.userId
    }
    const grant = request.cookies[BROWSE_COOKIE]
    if (grant !== undefined) {
      const userId = verifyGrant(tokenSecret, grant, Date.now(), 'browse')
      if (userId !== null) return userId
      return unauthorized(reply, '浏览会话已过期，请重新打开浏览器。')
    }
    return unauthorized(reply, '登录 AgehaOS 后才能使用浏览器。')
  }

  /** 仅主域会话（令牌签发专用：grant 不该再换 grant，防无界续期链）。 */
  const requireSessionUser = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> => {
    const token = request.cookies[SESSION_COOKIE]
    const session = token === undefined ? null : await store.findSession(token)
    if (!session || session.expiresAt <= Date.now()) {
      return unauthorized(reply, '登录 AgehaOS 后才能使用浏览器。')
    }
    return session.userId
  }

  const sendError = (
    reply: FastifyReply,
    status: number,
    title: string,
    message: string,
    target?: string,
    linkStyle: LinkStyle = 'query',
  ): FastifyReply =>
    reply
      .code(status)
      .type('text/html; charset=utf-8')
      .header('content-security-policy', ERROR_PAGE_CSP)
      .send(
        browseErrorPage({
          title,
          message,
          targetUrl: target,
          retryHref:
            target === undefined
              ? undefined
              : ((linkStyle === 'path' ? encodeBrowsePath(target) : null) ??
                buildBrowseUrl(target)),
        }),
      )

  // 路由级原始体解析（插件作用域内覆盖默认）：POST 的表单/JSON 体必须按
  // 原始字节转发上游，绝不解析成对象再序列化（boundary 与编码都会被破坏）。
  app.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'multipart/form-data', 'application/json', 'text/plain'],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  )

  const routeOptions = {
    // helmet 路由级覆盖：CSP 全关（代理文档要能加载原站资产与脚本）；
    // XFO 关停——子域文档要被主域（os 域）跨源 iframe 嵌入，SAMEORIGIN 会
    // 直接挡死；防点击劫持由统一的 frame-ancestors 头接管（'self' + 本地
    // 回环 + 配置来源）。COOP/nosniff 等其余头盔头保留。
    helmet: { contentSecurityPolicy: false, xFrameOptions: false },
    // 表单上传上限（默认全局 1MB 不够用）。
    bodyLimit: BROWSE_UPLOAD_MAX_BYTES,
    config: {
      // 沙箱 iframe 的表单 POST 带 `Origin: null`（不透明 origin 的序列化），
      // 无法被 origin-check 解析——本路由显式豁免；会话门 + SameSite=Lax
      // 仍是主保（跨站 POST 不带会话 cookie，到不了这里）。
      skipOriginCheck: true,
      rateLimit: {
        max: 120,
        timeWindow: options.rateLimitWindowMs,
        keyGenerator: (request: FastifyRequest) => request.cookies[SESSION_COOKIE] ?? request.ip,
      },
    },
  }

  /** 代理主体（三入口共用）：raw=目标 URL（已解码），linkStyle=重写产出形态。 */
  const runProxy = async (
    request: FastifyRequest,
    reply: FastifyReply,
    raw: string,
    linkStyle: LinkStyle,
  ): Promise<FastifyReply> => {
    // 统一的嵌入策略（含 401/错误页——任何出口都不得留 XFO 语义的残缺口）。
    reply.header('content-security-policy', frameAncestorsPolicy)
    /** 本入口的错误页（重试链接按入口形态产出）。 */
    const fail = (status: number, title: string, message: string, target?: string): FastifyReply =>
      sendError(reply, status, title, message, target, linkStyle)

    const userId = await requireUser(request, reply)
    if (userId === null) return reply
    // Cookie 罐：整个请求链（含重定向各跳）共享一份内存视图，逐跳吸收/附加；
    // 有变更即落盘（值仅存服务端——绝不回传浏览器、绝不进日志）。
    let jar = parseJar(await store.getBrowseJar(userId))
    const absorbCookies = async (current: URL, setCookies: readonly string[]): Promise<void> => {
      const origin = originOf(current.toString())
      if (origin === null || setCookies.length === 0) return
      jar = mergeSetCookies(jar, origin, setCookies, Date.now())
      await store.putBrowseJar(userId, serializeJar(capJarBytes(jar))).catch(() => undefined)
    }
    // POST 原始体与来源 content-type（透传上游；缺省无体）。
    const requestBody = Buffer.isBuffer(request.body) ? request.body : undefined
    const requestContentType = request.headers['content-type']

    let current: URL
    try {
      current = await assertPublicUrl(raw, policyOptions)
    } catch (cause) {
      if (cause instanceof BrowsePolicyError) {
        const blocked = cause.code === 'private-address' || cause.code === 'port-not-allowed'
        return fail(
          cause.status,
          blocked ? '该地址不允许访问' : '地址无法解析',
          blocked ? '代理只允许访问公网 http/https 地址（默认端口）。' : '请检查地址是否拼写正确。',
          raw,
        )
      }
      throw cause
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    /** 手动跟随重定向（每跳过 SSRF 闸）；返回终响应与最终 URL（重写 base 用）。 */
    const followRedirects = async (
      initial: URL,
      initialMethod: string,
      initialBody: Buffer | undefined,
    ): Promise<{ response: Response; finalUrl: string }> => {
      let current = initial
      let method = initialMethod
      let body = initialBody
      // 客户端显式头透传白名单（A2 审查）：range（媒体拖动进度条；SW 与页面
      // fetch 都会带）+ accept-language（页面语言协商，覆盖缺省 UA 头）。
      // if-* 条件头不转：响应恒 no-store 的代理管道没有 304 语义。
      const clientRange = request.headers.range
      const clientAcceptLanguage = request.headers['accept-language']
      for (let hop = 0; ; hop++) {
        const headers: Record<string, string> = { ...UPSTREAM_HEADERS }
        if (body !== undefined && requestContentType !== undefined) {
          headers['content-type'] = requestContentType
        }
        if (typeof clientRange === 'string' && clientRange !== '') headers.range = clientRange
        if (typeof clientAcceptLanguage === 'string' && clientAcceptLanguage !== '') {
          headers['accept-language'] = clientAcceptLanguage
        }
        // 罐附加：目标源有可用 cookie 时随行（登录态回放）。
        const hopOrigin = originOf(current.toString())
        if (hopOrigin !== null) {
          const cookieHeader = cookiesForOrigin(jar, hopOrigin, Date.now())
          if (cookieHeader !== null) headers.cookie = cookieHeader
        }
        const hopResponse = await fetcher(current.toString(), {
          method,
          // undici 的 BodyInit 不吃 Node Buffer，转 Uint8Array（同一内存视图）。
          body: body === undefined ? undefined : new Uint8Array(body),
          redirect: 'manual',
          signal: controller.signal,
          headers,
        })
        // 罐吸收：含重定向各跳（登录 302 的 Set-Cookie 在跳转链上生效）。
        await absorbCookies(current, hopResponse.headers.getSetCookie())
        if (!REDIRECT_STATUSES.has(hopResponse.status)) {
          return { response: hopResponse, finalUrl: current.toString() }
        }
        const location = hopResponse.headers.get('location')
        await hopResponse.body?.cancel().catch(() => undefined)
        if (location === null) return { response: hopResponse, finalUrl: current.toString() }
        if (hop >= BROWSE_MAX_REDIRECTS) {
          throw new BrowsePolicyError(502, 'too-many-redirects')
        }
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          throw new BrowsePolicyError(502, 'bad-redirect')
        }
        // HTTP 重定向方法规则：303 恒转 GET；301/302 对 POST 转 GET（历史
        // 语义，登录成功后的跳转靠它）；307/308 保方法保体。
        const status = hopResponse.status
        if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
          method = 'GET'
          body = undefined
        }
        // 每一跳都重新过闸：跳转向私网地址同样按策略拒绝。
        current = await assertPublicUrl(next.toString(), policyOptions)
      }
    }

    let response: Response
    let finalUrl: string
    try {
      ;({ response, finalUrl } = await followRedirects(current, request.method, requestBody))
    } catch (cause) {
      if (cause instanceof BrowsePolicyError) {
        if (cause.code === 'too-many-redirects') {
          return fail(502, '重定向过多', '目标站点的跳转次数超出上限。', raw)
        }
        if (cause.code === 'bad-redirect') {
          return fail(502, '重定向异常', '目标站点返回了无法解析的跳转地址。', raw)
        }
        return fail(cause.status, '该地址不允许访问', '跳转后的地址未通过代理策略。', raw)
      }
      if (cause instanceof Error && cause.name === 'AbortError') {
        return fail(504, '请求超时', '目标站点响应太慢，已中止。', raw)
      }
      return fail(502, '无法连接', '目标站点当前不可达。', raw)
    }

    if (response.status >= 300) {
      clearTimeout(timer)
      await response.body?.cancel().catch(() => undefined)
      return fail(
        502,
        '目标站点返回了错误',
        `上游返回 HTTP ${response.status}（页面可能不存在或需要登录）。`,
        raw,
      )
    }

    const contentType = response.headers.get('content-type')
    // content-disposition 透传（下载直通）：上游声明为附件时浏览器直接下载
    // （iframe 沙箱已开 allow-downloads）；未声明则照常内嵌展示。
    const disposition = response.headers.get('content-disposition')
    // 超时只护到响应头是不够的：慢滴响应体会让 readCapped 无限挂起。
    // 把 body 读取纳入同一截止时间，AbortError 映射为 504。
    let rawBytes: Uint8Array | null
    try {
      rawBytes = await readCapped(response, maxBytes)
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        return fail(504, '请求超时', '目标站点响应太慢，已中止。', raw)
      }
      return fail(502, '无法连接', '目标站点当前不可达。', raw)
    } finally {
      clearTimeout(timer)
    }
    if (rawBytes === null) {
      return fail(413, '页面过大', '目标页面超出代理的大小上限（5MB）。', raw)
    }

    const isHtml = contentType === null || /text\/html|application\/xhtml\+xml/i.test(contentType)
    if (!isHtml) {
      // 图片/PDF/附件/媒体直通字节；content-type/disposition 原样，但不放行
      // 上游的缓存/凭据头。Range 请求保留上游 206 与 content-range/accept-ranges
      // （A2 审查：视频/音频 seek 依赖分段响应；上游 206 时 rawBytes 即分段字节）。
      const passthrough = reply
        .code(response.status)
        .type(contentType ?? 'application/octet-stream')
        .header('cache-control', 'private, max-age=0, no-store')
      const contentRange = response.headers.get('content-range')
      if (contentRange !== null) passthrough.header('content-range', contentRange)
      const acceptRanges = response.headers.get('accept-ranges')
      if (acceptRanges !== null) passthrough.header('accept-ranges', acceptRanges)
      if (disposition !== null) passthrough.header('content-disposition', disposition)
      return passthrough.send(Buffer.from(rawBytes))
    }

    const charset = detectCharset(rawBytes, contentType)
    const decoded = decodeWithCharset(rawBytes, charset)
    const rewritten = rewriteHtml(decoded, finalUrl, {
      linkStyle,
      // query 模式注入的真实站 base 会把路径绝对链接解析到真站 origin；
      // 链接/表单 action 产出绝对代理 URL 才能稳定回流（A2 审查连带实证）。
      proxyOrigin: `${request.protocol}://${request.host}`,
    })
    const html = reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, max-age=0, no-store')
    if (linkStyle === 'query') html.header('content-security-policy', QUERY_SANDBOX_CSP)
    if (disposition !== null) html.header('content-disposition', disposition)
    return html.send(rewritten)
  }

  // ── 三入口（共用 runProxy）────────────────────────────────────────────────
  // ① query 兜底模式（原契约）；② 路径态文档（SW 缺席时直连也可渲染）；
  // ③ /raw 数据通道（SW 把子域内一切请求换算至此）。
  const parsePathTarget = (request: FastifyRequest): string | null => {
    // 手工解析原始 URL：保留 percent 编码原样（query 对象重拼会破坏编码）。
    const rawUrl = request.raw.url ?? ''
    const q = rawUrl.indexOf('?')
    const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q)
    const search = q === -1 ? '' : rawUrl.slice(q)
    return decodeBrowsePath(pathname, search)
  }
  const parseRawTarget = (request: FastifyRequest): string | null => {
    const rawUrl = request.raw.url ?? ''
    const q = rawUrl.indexOf('?')
    const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q)
    const search = q === -1 ? '' : rawUrl.slice(q)
    if (!pathname.startsWith('/raw/')) return null
    return decodeBrowsePath(pathname.slice('/raw'.length), search)
  }
  const missingTarget = (reply: FastifyReply, linkStyle: LinkStyle): FastifyReply =>
    sendError(reply, 400, '缺少地址', '请求里没有要打开的目标地址。', undefined, linkStyle)

  /**
   * 主域 query 兜底入口只服务 iframe 嵌入。顶层导航（恶意链接/地址栏直达）
   * 会让第三方页面在 os 主域顶层执行，必须拒绝；Sec-Fetch-Dest 仅真实浏览器
   * 导航会发送，inject/curl 无此头，测试与脚本调用不受影响。
   */
  const rejectTopLevelNavigation = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply | null =>
    request.headers['sec-fetch-dest'] === 'document'
      ? sendError(
          reply,
          403,
          '请通过应用打开',
          '该地址仅支持在 AgehaOS 浏览器窗口内使用。',
          undefined,
          'query',
        )
      : null

  /**
   * GET 表单目标（query 兜底模式）：重写侧把目标注入隐藏域
   * `__ageha_url`、action 指向裸 /api/browse——浏览器提交时 query 被表单
   * 数据整体替换，本函数把除标记外的查询参数（= 表单字段）追加回目标 URL，
   * 还原「GET 到原站 action」的语义。返回 null 表示不是表单提交。
   */
  const readFormTarget = (query: Record<string, unknown>): string | null => {
    const marker = query[BROWSE_FORM_TARGET_FIELD]
    if (typeof marker !== 'string' || marker.trim() === '') return null
    let target: URL
    try {
      target = new URL(marker)
    } catch {
      return marker
    }
    for (const [key, value] of Object.entries(query)) {
      if (key === BROWSE_FORM_TARGET_FIELD) continue
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        if (typeof item === 'string') target.searchParams.append(key, item)
      }
    }
    return target.toString()
  }

  app.get('/api/browse', routeOptions, async (request, reply) => {
    const blocked = rejectTopLevelNavigation(request, reply)
    if (blocked !== null) return blocked
    // GET 表单（隐藏域目标 + 表单字段）优先；普通链接/地址栏走 url 参数。
    const formTarget = readFormTarget(request.query as Record<string, unknown>)
    if (formTarget !== null) return runProxy(request, reply, formTarget, 'query')
    const raw = (request.query as { url?: string }).url
    if (typeof raw !== 'string' || raw.trim() === '') return missingTarget(reply, 'query')
    return runProxy(request, reply, raw, 'query')
  })
  app.post('/api/browse', routeOptions, async (request, reply) => {
    const blocked = rejectTopLevelNavigation(request, reply)
    if (blocked !== null) return blocked
    const raw = (request.query as { url?: string }).url
    if (typeof raw !== 'string' || raw.trim() === '') return missingTarget(reply, 'query')
    return runProxy(request, reply, raw, 'query')
  })
  for (const method of ['get', 'post'] as const) {
    app[method]('/https/*', routeOptions, async (request, reply) => {
      const target = parsePathTarget(request)
      if (target === null) return missingTarget(reply, 'path')
      return runProxy(request, reply, target, 'path')
    })
    app[method]('/http/*', routeOptions, async (request, reply) => {
      const target = parsePathTarget(request)
      if (target === null) return missingTarget(reply, 'path')
      return runProxy(request, reply, target, 'path')
    })
    app[method]('/raw/*', routeOptions, async (request, reply) => {
      const target = parseRawTarget(request)
      if (target === null) return missingTarget(reply, 'path')
      return runProxy(request, reply, target, 'path')
    })
  }

  // ── 子域自举（档 ③）──────────────────────────────────────────────────────
  // sw.js：SW 源码（薄层；无敏感内容，公开可取）。scope=/ 使子域全域受控。
  app.get('/sw.js', async (_request, reply) =>
    reply
      .code(200)
      .type('text/javascript; charset=utf-8')
      .header('service-worker-allowed', '/')
      .header('cache-control', 'no-cache')
      .send(browseSwSource()),
  )

  // __bootstrap：子域引导页——以 hash 令牌换取子域 browse cookie，注册 SW 并
  // 等待接管，随后 postMessage 通知主域外壳（消息只含 ok 布尔）。
  app.get('/__bootstrap', routeOptions, async (_request, reply) =>
    reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', frameAncestorsPolicy)
      .send(BOOTSTRAP_HTML),
  )

  // __claim：令牌（主域签发）→ 子域 httpOnly browse cookie（HMAC grant）。
  app.post('/__claim', routeOptions, async (request, reply) => {
    let token: string | null = null
    try {
      const parsed = JSON.parse(
        Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '',
      ) as { token?: unknown }
      if (typeof parsed.token === 'string') token = parsed.token
    } catch {
      token = null
    }
    const userId = token === null ? null : verifyGrant(tokenSecret, token, Date.now(), 'claim')
    if (userId === null) return reply.code(400).send({ error: 'invalid-token' })
    const grant = signGrant(tokenSecret, userId, BROWSE_GRANT_TTL_MS, Date.now(), 'browse')
    reply.setCookie(BROWSE_COOKIE, grant, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      maxAge: Math.floor(BROWSE_GRANT_TTL_MS / 1000),
    })
    return reply.code(200).send({ ok: true })
  })

  // token：主域（会话门）签发短期领取令牌——供外壳引导子域使用。
  app.get('/api/browse/token', async (request, reply) => {
    const userId = await requireSessionUser(request, reply)
    if (userId === null) return reply
    return reply
      .code(200)
      .send({ token: signGrant(tokenSecret, userId, CLAIM_TOKEN_TTL_MS, Date.now(), 'claim') })
  })

  // ── 站点数据（Cookie 罐）管理：起始页「清除站点数据」消费 ────────────────
  // 只回元信息（源列表 + 条目数），**绝不回 cookie 值**。
  // 仅主域会话可用：grant 只代表「某用户在某窗口里浏览」，不能把整罐的
  // 枚举/清空能力交给被代理页面（否则任意恶意站点可一键清掉全部登录态）。
  app.get('/api/browse/cookies', async (request, reply) => {
    const userId = await requireSessionUser(request, reply)
    if (userId === null) return reply
    const jar = parseJar(await store.getBrowseJar(userId))
    const origins = Object.keys(jar.origins)
    const count = origins.reduce((sum, origin) => sum + (jar.origins[origin]?.length ?? 0), 0)
    return reply.code(200).send({ count, origins })
  })

  app.post('/api/browse/cookies/clear', async (request, reply) => {
    const userId = await requireSessionUser(request, reply)
    if (userId === null) return reply
    await store.clearBrowseJar(userId)
    return reply.code(200).send({ cleared: true })
  })
}
