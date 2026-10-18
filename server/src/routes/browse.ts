import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  capJarBytes,
  cookiesForOrigin,
  mergeSetCookies,
  originOf,
  parseJar,
  serializeJar,
} from '../browse/cookie-jar'
import { assertPublicUrl, BrowsePolicyError, type ResolveHost } from '../browse/url-policy'
import {
  browseErrorPage,
  decodeWithCharset,
  detectCharset,
  rewriteHtml,
  buildBrowseUrl,
} from '../browse/rewrite'
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

  /** 会话门（sync/eclosion 同范式）：未登录给 HTML 错误页（iframe 里可读）；
   *  通过时返回 userId（Cookie 罐按用户隔离需要）。 */
  const requireUser = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) {
      void reply
        .code(401)
        .type('text/html; charset=utf-8')
        .send(browseErrorPage({ title: '需要登录', message: '登录 AgehaOS 后才能使用浏览器。' }))
      return null
    }
    const session = await store.findSession(token)
    if (!session || session.expiresAt <= Date.now()) {
      void reply
        .code(401)
        .type('text/html; charset=utf-8')
        .send(browseErrorPage({ title: '需要登录', message: '会话已过期，请重新登录。' }))
      return null
    }
    return session.userId
  }

  const sendError = (
    reply: FastifyReply,
    status: number,
    title: string,
    message: string,
    target?: string,
  ): FastifyReply =>
    reply
      .code(status)
      .type('text/html; charset=utf-8')
      .send(
        browseErrorPage({
          title,
          message,
          targetUrl: target,
          retryHref: target === undefined ? undefined : buildBrowseUrl(target),
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
    // XFO/COOP/nosniff 等其余头盔头保留（XFO SAMEORIGIN = 同源窗口可嵌）。
    helmet: { contentSecurityPolicy: false },
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

  const handleBrowse = async (
    request: FastifyRequest<{ Querystring: { url?: string } }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
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
    const raw = request.query.url
    if (typeof raw !== 'string' || raw.trim() === '') {
      return sendError(reply, 400, '缺少地址', '请求里没有要打开的目标地址。')
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
        return sendError(
          reply,
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
      for (let hop = 0; ; hop++) {
        const headers: Record<string, string> = { ...UPSTREAM_HEADERS }
        if (body !== undefined && requestContentType !== undefined) {
          headers['content-type'] = requestContentType
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
          return sendError(reply, 502, '重定向过多', '目标站点的跳转次数超出上限。', raw)
        }
        if (cause.code === 'bad-redirect') {
          return sendError(reply, 502, '重定向异常', '目标站点返回了无法解析的跳转地址。', raw)
        }
        return sendError(
          reply,
          cause.status,
          '该地址不允许访问',
          '跳转后的地址未通过代理策略。',
          raw,
        )
      }
      if (cause instanceof Error && cause.name === 'AbortError') {
        return sendError(reply, 504, '请求超时', '目标站点响应太慢，已中止。', raw)
      }
      return sendError(reply, 502, '无法连接', '目标站点当前不可达。', raw)
    } finally {
      clearTimeout(timer)
    }

    if (response.status >= 300) {
      await response.body?.cancel().catch(() => undefined)
      return sendError(
        reply,
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
    const rawBytes = await readCapped(response, maxBytes)
    if (rawBytes === null) {
      return sendError(reply, 413, '页面过大', '目标页面超出代理的大小上限（5MB）。', raw)
    }

    const isHtml = contentType === null || /text\/html|application\/xhtml\+xml/i.test(contentType)
    if (!isHtml) {
      // 图片/PDF/附件等直通字节；content-type/disposition 原样，但不放行
      // 上游的缓存/凭据头。
      const passthrough = reply
        .code(200)
        .type(contentType ?? 'application/octet-stream')
        .header('cache-control', 'private, max-age=0, no-store')
      if (disposition !== null) passthrough.header('content-disposition', disposition)
      return passthrough.send(Buffer.from(rawBytes))
    }

    const charset = detectCharset(rawBytes, contentType)
    const decoded = decodeWithCharset(rawBytes, charset)
    const rewritten = rewriteHtml(decoded, finalUrl)
    const html = reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, max-age=0, no-store')
    if (disposition !== null) html.header('content-disposition', disposition)
    return html.send(rewritten)
  }

  app.get<{ Querystring: { url?: string } }>('/browse', routeOptions, handleBrowse)
  app.post<{ Querystring: { url?: string } }>('/browse', routeOptions, handleBrowse)

  // ── 站点数据（Cookie 罐）管理：起始页「清除站点数据」消费 ────────────────
  // 只回元信息（源列表 + 条目数），**绝不回 cookie 值**。
  app.get('/browse/cookies', async (request, reply) => {
    const userId = await requireUser(request, reply)
    if (userId === null) return reply
    const jar = parseJar(await store.getBrowseJar(userId))
    const origins = Object.keys(jar.origins)
    const count = origins.reduce((sum, origin) => sum + (jar.origins[origin]?.length ?? 0), 0)
    return reply.code(200).send({ count, origins })
  })

  app.post('/browse/cookies/clear', async (request, reply) => {
    const userId = await requireUser(request, reply)
    if (userId === null) return reply
    await store.clearBrowseJar(userId)
    return reply.code(200).send({ cleared: true })
  })
}
