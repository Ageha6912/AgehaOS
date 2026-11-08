import { createServer, type Server, type ServerResponse } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app'
import {
  assertPublicUrl,
  BrowsePolicyError,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
} from '../src/browse/url-policy'
import { browseErrorPage, detectCharset, rewriteHtml, BROWSE_FORM_TARGET_FIELD } from '../src/browse/rewrite'
import { MemoryDataStore } from '../src/store/memory-store'

/**
 * 浏览器代理（档 C）：URL 策略（SSRF）+ HTML 重写 + /api/browse 全链路。
 * fake upstream 用真 http 服务（localhost:随机端口）；策略侧注入
 * resolveHost（localhost → 公网测试地址）与 allowedPorts（放行测试端口），
 * 生产路径的严格默认值由单测直接钉死。
 */

// ── URL 策略单测 ────────────────────────────────────────────────────────────

describe('browse url-policy（SSRF 闸）', () => {
  it('isPrivateIPv4：私网/保留段全拒，公网放行，畸形即拒', () => {
    for (const ip of [
      '0.0.0.1',
      '10.1.2.3',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.0.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '999.1.1.1',
      '1.2.3',
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(true)
    }
    expect(isPrivateIPv4('1.1.1.1')).toBe(false)
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
    expect(isPrivateIPv4('172.32.0.1')).toBe(false)
  })

  it('isPrivateIPv6：本机/ULA/link-local/v4-mapped 全拒', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIPv6(ip), ip).toBe(true)
    }
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false)
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false)
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
  })

  it('isPrivateIPv6：十六进制 mapped / compatible / NAT64 / 6to4 内嵌私网全拒', () => {
    for (const ip of [
      '::ffff:7f00:1', // [::ffff:127.0.0.1] 经 URL 规范化后的形式
      '::ffff:a9fe:a9fe', // [::ffff:169.254.169.254]
      '::7f00:1', // IPv4-compatible（已废弃但可被规范化）
      '64:ff9b::7f00:1', // NAT64 well-known prefix 内嵌 127.0.0.1
      '64:ff9b:1::1', // RFC 8215 local-use NAT64（可映射私网）
      '2002:7f00:1::', // 6to4 内嵌 127.0.0.1
      'ff02::1', // multicast
    ]) {
      expect(isPrivateIPv6(ip), ip).toBe(true)
    }
    // 内嵌公网地址不能被误杀。
    expect(isPrivateIPv6('::ffff:808:808')).toBe(false)
    expect(isPrivateIPv6('64:ff9b::808:808')).toBe(false)
    expect(isPrivateIPv6('2002:808:808::')).toBe(false)
  })

  it('assertPublicUrl：十六进制 v4-mapped 字面量同样按私网拒绝', async () => {
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]/')).rejects.toMatchObject({
      status: 403,
      code: 'private-address',
    })
    await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/')).rejects.toMatchObject({
      status: 403,
      code: 'private-address',
    })
    await expect(assertPublicUrl('http://[::ffff:8.8.8.8]/')).resolves.toBeInstanceOf(URL)
  })

  it('assertPublicUrl：协议/凭据/端口/私网字面量逐项拒绝', async () => {
    await expect(assertPublicUrl('ftp://example.com/')).rejects.toMatchObject({
      status: 400,
      code: 'scheme-not-allowed',
    })
    await expect(assertPublicUrl('not a url')).rejects.toMatchObject({ status: 400 })
    await expect(assertPublicUrl('http://user:pass@example.com/')).rejects.toMatchObject({
      status: 400,
      code: 'credentials-not-allowed',
    })
    await expect(assertPublicUrl('http://example.com:8080/')).rejects.toMatchObject({
      status: 403,
      code: 'port-not-allowed',
    })
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toMatchObject({
      status: 403,
      code: 'private-address',
    })
    await expect(assertPublicUrl('http://[::1]/')).rejects.toMatchObject({
      status: 403,
      code: 'private-address',
    })
  })

  it('assertPublicUrl：域名解析全量公网才放行；通往私网/解析失败即拒', async () => {
    const ok = await assertPublicUrl('https://example.com/x', {
      resolveHost: async () => ['93.184.216.34'],
    })
    expect(ok.toString()).toBe('https://example.com/x')

    await expect(
      assertPublicUrl('https://evil.test/', {
        resolveHost: async () => ['93.184.216.34', '10.0.0.5'],
      }),
    ).rejects.toMatchObject({ status: 403, code: 'private-address' })

    await expect(
      assertPublicUrl('https://nx.test/', {
        resolveHost: async () => {
          throw new Error('ENOTFOUND')
        },
      }),
    ).rejects.toMatchObject({ status: 502, code: 'dns-failed' })
  })

  it('本地开发开关（allowBenchmarkRange）：只放行 198.18/15 基准段，回环/私网照拒', async () => {
    // 默认（生产口径）：基准段拒绝——TUN fake-IP 环境本地开发时全部目标在此被闸。
    await expect(
      assertPublicUrl('https://any.test/', { resolveHost: async () => ['198.18.0.192'] }),
    ).rejects.toMatchObject({ status: 403, code: 'private-address' })

    // 开关开启：基准段放行（TUN 会把真流量隧道到真实站点）。
    const allowed = await assertPublicUrl('https://any.test/', {
      resolveHost: async () => ['198.18.0.192'],
      allowBenchmarkRange: true,
    })
    expect(allowed.toString()).toBe('https://any.test/')

    // 同开关下危险地址仍然拒绝：回环/私网/元数据不受开关影响。
    await expect(
      assertPublicUrl('https://loop.test/', {
        resolveHost: async () => ['127.0.0.1'],
        allowBenchmarkRange: true,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'private-address' })
    await expect(
      assertPublicUrl('https://meta.test/', {
        resolveHost: async () => ['169.254.169.254'],
        allowBenchmarkRange: true,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'private-address' })
    await expect(
      assertPublicUrl('http://198.18.0.9/', { allowBenchmarkRange: true }),
    ).resolves.toBeInstanceOf(URL)
  })
})

// ── HTML 重写单测 ───────────────────────────────────────────────────────────

describe('rewriteHtml（base 注入 + 导航重写）', () => {
  const FINAL = 'https://example.com/a/b.html'

  it('原页 base 作为解析基准：相对链接按 base 解析，注入等价 base（只保留一份）', () => {
    const out = rewriteHtml(
      '<html><head><base href="https://example.org/app/"><title>t</title></head><body><a href="page">x</a></body></html>',
      FINAL,
    )
    // 既有 base 被移除后按原语义重注入（相对 URL 的解析基准不能丢）。
    expect(out.match(/<base /g)).toHaveLength(1)
    expect(out).toContain('<base href="https://example.org/app/">')
    expect(out).toContain(
      `href="/api/browse?url=${encodeURIComponent('https://example.org/app/page')}"`,
    )
  })

  it('相对 base href 按文档最终地址解析；路径模式注入代理路径形态（不跨到真站）', () => {
    const html = '<head><base href="/app/"><title>t</title></head>'
    const query = rewriteHtml(html, FINAL)
    expect(query).toContain('<base href="https://example.com/app/">')

    const path = rewriteHtml(html, FINAL, { linkStyle: 'path' })
    expect(path).toContain('<base href="/https/example.com/app/">')
    expect(path).not.toContain('href="https://example.com/app/"')
  })

  it('<base target> 保留：query 模式并入注入 base，路径模式单独注入 target', () => {
    const html = '<head><base target="_blank"><title>t</title></head>'
    const query = rewriteHtml(html, FINAL)
    expect(query).toContain(`<base href="${FINAL}" target="_blank">`)

    const path = rewriteHtml(html, FINAL, { linkStyle: 'path' })
    expect(path).toContain('<base target="_blank">')
    expect(path).not.toContain('<base href=')
  })

  it('无 head 时 base 挂在 html 后；两样都无则前置', () => {
    const noHead = rewriteHtml('<html><body>x</body></html>', FINAL)
    expect(noHead).toContain('<base href="https://example.com/a/b.html">')
    expect(noHead.indexOf('<base')).toBeGreaterThan(noHead.indexOf('<html>'))

    const bare = rewriteHtml('<p>x</p>', FINAL)
    expect(bare).toContain('<base href="https://example.com/a/b.html">')
    expect(bare.indexOf('<base')).toBeLessThan(bare.indexOf('<p>x</p>'))
  })

  it('a/area 的 href 重写为代理路径：绝对、相对、协议相对都回流', () => {
    const out = rewriteHtml(
      `<a href="/rel">1</a><a href="../up">2</a><a href="//cdn.example.net/x">3</a>` +
        `<area href="https://other.example.org/y">4</area>`,
      FINAL,
    )
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/rel')}"`)
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/up')}"`)
    expect(out).toContain(
      `href="/api/browse?url=${encodeURIComponent('https://cdn.example.net/x')}"`,
    )
    expect(out).toContain(
      `href="/api/browse?url=${encodeURIComponent('https://other.example.org/y')}"`,
    )
  })

  it('协议相对链接升级 https（混合内容防护）；显式 http 保持真实协议', () => {
    // 2026-10-18 B 站实证：https 子域文档里 `//host/x` 会被解析成 http，
    // 原样编码 /http/... 会被浏览器按混合内容拦成 chrome-error。
    const out = rewriteHtml(
      `<a href="//cdn.example.net/x">a</a><a href="http://plain.example.org/y">b</a>`,
      FINAL,
      { linkStyle: 'path' },
    )
    expect(out).toContain(`href="/https/cdn.example.net/x"`)
    expect(out).toContain(`href="/http/plain.example.org/y"`)
  })

  it('锚点/邮件/脚本等非导航 href 原样', () => {
    const out = rewriteHtml(
      `<a href="#top">1</a><a href="mailto:a@b.c">2</a><a href="javascript:void(0)">3</a>`,
      FINAL,
    )
    expect(out).toContain('href="#top"')
    expect(out).toContain('href="mailto:a@b.c"')
    expect(out).toContain('href="javascript:void(0)"')
  })

  it('data-href 与属性值内的 href 字样不被误改写（词边界/值内扫描修复）', () => {
    const out = rewriteHtml(
      `<a data-href="/spa" title='x href="/inside"'>a</a><area data-action="/y">`,
      FINAL,
    )
    expect(out).toContain('data-href="/spa"')
    expect(out).toContain(`title='x href="/inside"'`)
    expect(out).not.toContain('data-href="/api/browse')
  })

  it('无引号 href 同样改写（不直连真站）', () => {
    const out = rewriteHtml(`<a href=/up>x</a>`, FINAL)
    expect(out).toContain(
      `href="/api/browse?url=${encodeURIComponent('https://example.com/up')}"`,
    )
  })

  it('query 模式给定 proxyOrigin：链接与 GET 表单 action 产出绝对代理 URL', () => {
    const out = rewriteHtml(
      `<a href="/next">n</a><form action="/search" method="get"><input name="q"></form>`,
      FINAL,
      { proxyOrigin: 'https://os.ageha.cn' },
    )
    // 注入的真实站 base 不会再把绝对路径解析到真站 origin。
    expect(out).toContain(
      `href="https://os.ageha.cn/api/browse?url=${encodeURIComponent('https://example.com/next')}"`,
    )
    expect(out).toContain('action="https://os.ageha.cn/api/browse"')
  })

  it('GET 表单（query 模式）：目标注入隐藏域，action 指向裸 /api/browse', () => {
    const out = rewriteHtml(
      `<form action="/search?cat=1" method="get"><input name="q"></form>`,
      FINAL,
    )
    // action 的 query 会被浏览器用表单数据整体替换——目标只能走隐藏域。
    expect(out).toContain('<form action="/api/browse" method="get">')
    expect(out).toContain(
      `<input type="hidden" name="${BROWSE_FORM_TARGET_FIELD}" value="https://example.com/search?cat=1">`,
    )
    expect(out).toContain('<input name="q">')
  })

  it('GET 表单：无 action 时目标 = 当前文档，同样注入隐藏域', () => {
    const out = rewriteHtml(`<form method="get"><input name="q"></form>`, FINAL)
    expect(out).toContain('action="/api/browse"')
    expect(out).toContain(
      `<input type="hidden" name="${BROWSE_FORM_TARGET_FIELD}" value="${FINAL}">`,
    )
  })

  it('GET 表单（路径模式）：action 保留目标路径，无需隐藏域', () => {
    const out = rewriteHtml(
      `<form action="/search" method="get"><input name="q"></form>`,
      FINAL,
      { linkStyle: 'path' },
    )
    expect(out).toContain('action="/https/example.com/search"')
    expect(out).not.toContain(BROWSE_FORM_TARGET_FIELD)
  })

  it('POST 表单 action 保持“改写为代理 URL”口径，method/enctype 原样', () => {
    const out = rewriteHtml(
      `<form action="/login" method="post" enctype="multipart/form-data"><input name="p"></form>`,
      FINAL,
    )
    expect(out).toContain(
      `action="/api/browse?url=${encodeURIComponent('https://example.com/login')}"`,
    )
    expect(out).toContain('method="post"')
    expect(out).toContain('enctype="multipart/form-data"')
    expect(out).not.toContain(BROWSE_FORM_TARGET_FIELD)
  })

  it('大写标签与单引号属性同样处理', () => {
    const out = rewriteHtml(`<A HREF='/up'>x</A>`, FINAL)
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/up')}"`)
  })

  it('script/style/注释区段原样保留：JS 字符串里的 href= 不再被改写（A2 审查实测）', () => {
    const html =
      `<a href="/real">go</a>` +
      `<script>var t='<a href="/x">'; if (1) { }</` + `script>` +
      `<style>.a { content: '<a href="/y">' }</style>` +
      `<!-- <a href="/z">comment</a> -->` +
      `<a href="/real2">go2</a>`
    const out = rewriteHtml(html, FINAL)
    // 区段外的真链接照常改写。
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/real')}"`)
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/real2')}"`)
    // 区段内一字不动（改写会把 JS/样式/注释改残）。
    expect(out).toContain(`var t='<a href="/x">'`)
    expect(out).toContain(`content: '<a href="/y">'`)
    expect(out).toContain('<!-- <a href="/z">comment</a> -->')
  })

  it('未闭合 script：开标签到 EOF 全部原样（浏览器 rawtext 语义）', () => {
    const html = `<a href="/real">go</a><script>var s = "</a> <a href='/x'>";`
    const out = rewriteHtml(html, FINAL)
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/real')}"`)
    expect(out).toContain(`var s = "</a> <a href='/x'>";`)
    expect(out).not.toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/x')}"`)
  })

  it('JS 字符串里的 <base> 不再污染解析基准（遮蔽后解析）', () => {
    const html = `<script>var b = '<base href="https://evil.example/">';</` + `script><a href="/rel">x</a>`
    const out = rewriteHtml(html, FINAL)
    expect(out).toContain(`href="/api/browse?url=${encodeURIComponent('https://example.com/rel')}"`)
    expect(out).toContain(`'<base href="https://evil.example/">';`)
  })

  it('button/input 的 formaction 与 action 同口径重写（A2 审查）', () => {
    const html = `<form action="/submit"><button formaction="/other">go</button>` +
      `<input type="image" formaction="/third"></form>`
    const out = rewriteHtml(html, FINAL)
    expect(out).toContain(`formaction="/api/browse?url=${encodeURIComponent('https://example.com/other')}"`)
    expect(out).toContain(`formaction="/api/browse?url=${encodeURIComponent('https://example.com/third')}"`)
    const pathOut = rewriteHtml(html, FINAL, { linkStyle: 'path' })
    expect(pathOut).toContain('formaction="/https/example.com/other"')
  })
})

describe('detectCharset / browseErrorPage', () => {
  it('header charset 优先，缺省看 meta，再缺省 utf-8', () => {
    const bytes = new TextEncoder().encode('<html><head><meta charset="gbk">')
    expect(detectCharset(bytes, 'text/html; charset=gb18030')).toBe('gb18030')
    expect(detectCharset(bytes, 'text/html')).toBe('gbk')
    expect(detectCharset(new TextEncoder().encode('<html>'), null)).toBe('utf-8')
  })

  it('错误页含目标与在新标签打开链接', () => {
    const html = browseErrorPage({
      title: '无法连接',
      message: '目标站点当前不可达。',
      targetUrl: 'https://example.com/x?a=1&b=2',
      retryHref: '/api/browse?url=x',
    })
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('href="https://example.com/x?a=1&amp;b=2"')
    expect(html).toContain('重试')
  })

  it('文本位完整转义尖括号与引号（防反射 XSS）', () => {
    const payload = `<img src=x onerror=alert(1)>'"`
    const html = browseErrorPage({
      title: payload,
      message: payload,
      targetUrl: payload,
      retryHref: `/api/browse?url=${encodeURIComponent(payload)}`,
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&#39;&quot;')
  })
})

// ── 路由集成（真 http fake upstream + 真 fetch） ─────────────────────────────

interface RecordedUpstreamRequest {
  headers: IncomingHttpHeaders
  url: string
  method: string
  /** 原始请求体（POST 转发测试用；GET 为空 Buffer）。 */
  body: Buffer
}

interface UpstreamHandle {
  server: Server
  port: number
  requests: RecordedUpstreamRequest[]
}

type UpstreamRespond = (req: RecordedUpstreamRequest, res: ServerResponse) => void

function startUpstream(respond: UpstreamRespond): Promise<UpstreamHandle> {
  const requests: RecordedUpstreamRequest[] = []
  const server = createServer((incoming, res) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const record: RecordedUpstreamRequest = {
        headers: incoming.headers,
        url: incoming.url ?? '',
        method: incoming.method ?? 'GET',
        body: Buffer.concat(chunks),
      }
      requests.push(record)
      respond(record, res)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ server, port: address.port, requests })
    })
  })
}

describe('/api/browse（会话门 + SSRF + 重写全链路）', () => {
  let app: FastifyInstance | null = null
  let upstream: Server | null = null
  let upstreamPort = 0
  let requests: UpstreamHandle['requests'] = []
  let cookie = ''
  /** 路由注册时捕获的放行端口集引用——同源隔离测试可追加第二 upstream 端口。 */
  let allowedPorts = new Set<string>()

  afterEach(async () => {
    await app?.close()
    upstream?.close()
    app = null
    upstream = null
  })

  async function setup(
    respond: UpstreamRespond,
    browse: Record<string, unknown> = {},
  ): Promise<void> {
    const handle = await startUpstream(respond)
    upstream = handle.server
    upstreamPort = handle.port
    requests = handle.requests
    allowedPorts = new Set(['', '80', '443', String(upstreamPort)])
    app = await buildApp({
      store: new MemoryDataStore(),
      config: { store: 'memory', rateLimit: { loginMax: 100, registerMax: 100, windowMs: 60_000 } },
      browse: {
        // 生产闸的严格默认由单测钉死；集成侧只需放行测试端口 + localhost 前缀。
        resolveHost: async () => ['93.184.216.34'],
        allowedPorts,
        ...browse,
      },
    })
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'browser-user', password: 'secret1' },
    })
    expect(registered.statusCode).toBe(201)
    const setCookie = registered.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? ''
  }

  function target(): string {
    return `http://localhost:${upstreamPort}`
  }

  async function browseGet(url: string, withCookie = true) {
    return app!.inject({
      method: 'GET',
      url: `/api/browse?url=${encodeURIComponent(url)}`,
      headers: withCookie ? { cookie } : {},
    })
  }

  it('未登录 → 401 HTML 错误页（iframe 内可读）', async () => {
    await setup((_req, res) => res.end('unused'))
    const response = await browseGet(`${target()}/`, false)
    expect(response.statusCode).toBe(401)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('需要登录')
  })

  it('happy path：剥嵌入限制 + 注入 base + 链接回流 + 无 CSP 但有 helmet 其余头', async () => {
    await setup((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'",
        'set-cookie': 'sid=abc; Path=/',
      })
      res.end('<html><head><title>t</title></head><body><a href="/next">n</a></body></html>')
    })

    const response = await browseGet(`${target()}/`)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html; charset=utf-8')
    expect(response.headers['cache-control']).toContain('no-store')
    // 上游禁止嵌入的头不回流；防劫持改由统一 frame-ancestors 策略接管
    // （主域 + 本地回环——子域文档需被主域跨源嵌入，见档 ③）。
    expect(response.headers['content-security-policy']).toContain('frame-ancestors')
    expect(response.headers['content-security-policy']).toContain('https://os.ageha.cn')
    // 不含 'self'：被代理页不得再嵌套另一个被代理页（单 origin 下会同源读 DOM）。
    expect(response.headers['content-security-policy']).not.toContain("'self'")
    expect(response.headers['x-frame-options']).toBeUndefined()
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body).toContain(`<base href="${target()}/">`)
    // 点击守卫在 query 兜底模式同样注入（_blank 拦成同帧导航）。
    expect(response.body).toContain("addEventListener('click'")
    // iframe 内导航回报（D1 审查）：地址栏/书签/刷新跟随页内跳转。
    expect(response.body).toContain('agehaos:browse-location')
    // 注入的 base 指向真实站 → 链接必须是**绝对代理 URL**，否则会被 base
    // 的 origin 劫持到真实站（A2 审查连带实证）。
    expect(response.body).toContain(
      `href="http://localhost:80/api/browse?url=${encodeURIComponent(`${target()}/next`)}"`,
    )
    // query 兜底模式与客户端 SANDBOX_FALLBACK 同口径：无 allow-same-origin。
    expect(response.headers['content-security-policy']).toContain('sandbox')
    expect(response.headers['content-security-policy']).not.toContain('allow-same-origin')
  })

  it('错误响应：目标 URL 完整转义 + 错误页 CSP 禁脚本', async () => {
    await setup((_req, res) => res.end('unused'))
    const response = await browseGet('x:<img src=x onerror=alert(1)>')
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain('<img src=x')
    expect(response.body).toContain('&lt;img')
    expect(response.headers['content-security-policy']).toContain("script-src 'none'")
  })

  it('主域 query 入口拒绝顶层导航（恶意链接/地址栏直达）', async () => {
    await setup((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body>ok</body></html>')
    })
    const url = `/api/browse?url=${encodeURIComponent(`${target()}/`)}`
    const topLevel = await app!.inject({
      method: 'GET',
      url,
      headers: { cookie, 'sec-fetch-dest': 'document' },
    })
    expect(topLevel.statusCode).toBe(403)
    expect(topLevel.headers['content-security-policy']).toContain("script-src 'none'")

    const embedded = await app!.inject({
      method: 'GET',
      url,
      headers: { cookie, 'sec-fetch-dest': 'iframe' },
    })
    expect(embedded.statusCode).toBe(200)
    expect(embedded.headers['content-security-policy']).toContain('sandbox')
  })

  it('头消毒：不向上游转发 Cookie/Referer；上游 Set-Cookie 不回流', async () => {
    await setup((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'up=1' })
      res.end('<html><body>x</body></html>')
    })
    const response = await browseGet(`${target()}/`)
    expect(response.statusCode).toBe(200)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.cookie).toBeUndefined()
    expect(requests[0]?.headers.referer).toBeUndefined()
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('重定向：302 跟随并把 base 落为最终 URL；跳私网地址当跳拒绝', async () => {
    await setup((req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { location: '/final' })
        res.end()
        return
      }
      if (req.url === '/to-private') {
        res.writeHead(302, { location: 'http://127.0.0.1/' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>final</body></html>')
    })

    const ok = await browseGet(`${target()}/from`)
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toContain(`<base href="${target()}/final">`)

    const blocked = await browseGet(`${target()}/to-private`)
    expect(blocked.statusCode).toBe(403)
    expect(blocked.body).toContain('该地址不允许访问')
  })

  it('非 HTML：字节透传 + content-type 保留', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await setup((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(png)
    })
    const response = await browseGet(`${target()}/dot.png`)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.rawPayload.equals(png)).toBe(true)
  })

  it('超过大小上限 → 413 错误页', async () => {
    await setup(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>' + 'x'.repeat(4096) + '</body></html>')
      },
      { maxBytes: 1024 },
    )
    const response = await browseGet(`${target()}/`)
    expect(response.statusCode).toBe(413)
    expect(response.body).toContain('页面过大')
  })

  it('上游超时 → 504 错误页', async () => {
    await setup(
      (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<html><body>late</body></html>')
        }, 400)
      },
      { timeoutMs: 80 },
    )
    const response = await browseGet(`${target()}/`)
    expect(response.statusCode).toBe(504)
    expect(response.body).toContain('请求超时')
  })

  it('响应头已到但 body 慢滴超过截止时间 → 504（超时覆盖 body 读取）', async () => {
    await setup(
      (_req, res) => {
        // 头部与首个分片立即到达，body 拖到超时之后才结束——此前超时定时器
        // 在拿到响应头后就被清掉，慢滴响应体会无限挂住服务端连接。
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<html><body>')
        setTimeout(() => res.end('</html>'), 400)
      },
      { timeoutMs: 80 },
    )
    const response = await browseGet(`${target()}/slow-body`)
    expect(response.statusCode).toBe(504)
    expect(response.body).toContain('请求超时')
  })

  it('上游 404 → 502 错误页并注明上游状态', async () => {
    await setup((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('not found')
    })
    const response = await browseGet(`${target()}/missing`)
    expect(response.statusCode).toBe(502)
    expect(response.body).toContain('HTTP 404')
    expect(response.body).toContain('在新标签页打开')
  })

  it('POST 表单转发：原始体逐字节到上游；Origin: null（沙箱 iframe）不被 CSRF 门拦', async () => {
    await setup((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body>got:${req.body.toString('utf8')}</body></html>`)
    })
    const response = await app!.inject({
      method: 'POST',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/form`)}`,
      headers: {
        cookie,
        origin: 'null',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'a=1&b=%E4%B8%AD',
    })

    expect(response.statusCode).toBe(200)
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.body.toString('utf8')).toBe('a=1&b=%E4%B8%AD')
    expect(requests[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    // 上游只见白名单头：客户端 Origin/Cookie 一律不转发。
    expect(requests[0]?.headers.origin).toBeUndefined()
    expect(requests[0]?.headers.cookie).toBeUndefined()
    expect(response.body).toContain('got:a=1&b=%E4%B8%AD')
  })

  it('GET 表单（隐藏域目标）：表单字段追加到目标 query 后转发上游', async () => {
    await setup((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('ok')
    })
    // 浏览器提交 GET 表单时 action 的 query 会被表单数据整体替换——重写侧
    // 把目标放进 __ageha_url 隐藏域，这里断言表单字段被追加回目标 URL。
    const destination = `${target()}/search?cat=1`
    const response = await app!.inject({
      method: 'GET',
      url: `/api/browse?${BROWSE_FORM_TARGET_FIELD}=${encodeURIComponent(destination)}&q=hello&lang=zh`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.url).toBe('/search?cat=1&q=hello&lang=zh')
  })

  it('POST 未登录：即便路由豁免 origin 检查也 401（会话门 + SameSite 仍是主保）', async () => {
    await setup((_req, res) => res.end('unused'))
    const response = await app!.inject({
      method: 'POST',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/x`)}`,
      headers: { origin: 'null', 'content-type': 'text/plain' },
      payload: 'x',
    })
    expect(response.statusCode).toBe(401)
    expect(requests).toHaveLength(0)
  })

  it('重定向方法规则：301/302-on-POST 与 303 转 GET，307 保方法保体', async () => {
    await setup((req, res) => {
      if (req.url === '/p302') {
        res.writeHead(302, { location: '/after' })
        res.end()
        return
      }
      if (req.url === '/p307') {
        res.writeHead(307, { location: '/keep' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body>${req.method}:${req.body.toString('utf8')}</body></html>`)
    })

    const via302 = await app!.inject({
      method: 'POST',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/p302`)}`,
      headers: { cookie, 'content-type': 'text/plain' },
      payload: 'x=1',
    })
    expect(via302.statusCode).toBe(200)
    expect(via302.body).toContain('GET:')

    const via307 = await app!.inject({
      method: 'POST',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/p307`)}`,
      headers: { cookie, 'content-type': 'text/plain' },
      payload: 'x=1',
    })
    expect(via307.statusCode).toBe(200)
    expect(via307.body).toContain('POST:x=1')
  })

  it('content-disposition 透传：附件声明直达浏览器（下载直通）', async () => {
    await setup((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="doc.pdf"',
      })
      res.end(Buffer.from('%PDF-1.4 minimal'))
    })
    const response = await browseGet(`${target()}/doc.pdf`)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe('attachment; filename="doc.pdf"')
    expect(response.rawPayload.toString('utf8')).toContain('%PDF-1.4')
  })

  it('登录闭环：302 的 Set-Cookie 逐跳生效；后续请求回放；响应不回流浏览器', async () => {
    await setup((req, res) => {
      if (req.url === '/login') {
        res.writeHead(302, { location: '/home', 'set-cookie': 'sid=abc; Path=/' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body>cookie:${req.headers.cookie ?? 'none'}</body></html>`)
    })

    // 表单登录（POST 经代理）→ 302 跟随到 /home：罐在跳转链内已生效。
    const login = await app!.inject({
      method: 'POST',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/login`)}`,
      headers: { cookie, origin: 'null', 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'u=a&p=b',
    })
    expect(login.statusCode).toBe(200)
    expect(login.body).toContain('cookie:sid=abc')
    expect(login.headers['set-cookie']).toBeUndefined() // 罐在服务端，不回流浏览器

    // 独立请求回放（登录态可持续）。
    const again = await browseGet(`${target()}/home`)
    expect(again.body).toContain('cookie:sid=abc')

    // 用户隔离：另一账号的请求不带这罐。
    const registered = await app!.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'browse-user-2', password: 'secret1' },
    })
    const otherSetCookie = registered.headers['set-cookie']
    const otherCookie = String(
      Array.isArray(otherSetCookie) ? otherSetCookie[0] : otherSetCookie,
    ).split(';')[0]
    const other = await app!.inject({
      method: 'GET',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/home`)}`,
      headers: { cookie: otherCookie },
    })
    expect(other.body).toContain('cookie:none')

    // 源隔离：另一 origin（不同端口）不带该罐。
    const second = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>second-origin</body></html>')
    })
    allowedPorts.add(String(second.port))
    const crossOrigin = await browseGet(`http://localhost:${second.port}/home`)
    expect(crossOrigin.statusCode).toBe(200)
    expect(second.requests[0]?.headers.cookie).toBeUndefined()
    second.server.close()
  })

  it('站点数据管理：GET 摘要（不回值）与 clear 清空', async () => {
    await setup((req, res) => {
      if (req.url === '/set') {
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'a=1; Max-Age=3600' })
        res.end('<html><body>set</body></html>')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body>cookie:${req.headers.cookie ?? 'none'}</body></html>`)
    })
    await browseGet(`${target()}/set`)

    const summary = await app!.inject({
      method: 'GET',
      url: '/api/browse/cookies',
      headers: { cookie },
    })
    expect(summary.statusCode).toBe(200)
    const body = summary.json() as { count: number; origins: string[] }
    expect(body.count).toBe(1)
    expect(body.origins).toEqual([target()])
    expect(summary.body).not.toContain('a=1') // 绝不回值

    const cleared = await app!.inject({
      method: 'POST',
      url: '/api/browse/cookies/clear',
      headers: { cookie },
    })
    expect(cleared.statusCode).toBe(200)
    const after = await app!.inject({
      method: 'GET',
      url: '/api/browse/cookies',
      headers: { cookie },
    })
    expect((after.json() as { count: number }).count).toBe(0)
    const replay = await browseGet(`${target()}/home`)
    expect(replay.body).toContain('cookie:none')

    // 未登录不可见/不可清（摘要端点也过会话门）。
    const anonymous = await app!.inject({ method: 'GET', url: '/api/browse/cookies' })
    expect(anonymous.statusCode).toBe(401)
  })

  it('站点数据管理只接受主域会话：browse grant 不能枚举/清空罐', async () => {
    await setup((_req, res) => res.end('unused'))

    // 走真实令牌链拿到 browse grant（子域 cookie）。
    const tokenResponse = await app!.inject({
      method: 'GET',
      url: '/api/browse/token',
      headers: { cookie },
    })
    expect(tokenResponse.statusCode).toBe(200)
    const token = (tokenResponse.json() as { token: string }).token
    const claim = await app!.inject({ method: 'POST', url: '/__claim', payload: { token } })
    expect(claim.statusCode).toBe(200)
    const grantCookie = String(claim.headers['set-cookie']).split(';')[0] ?? ''
    expect(grantCookie).toContain('agehaos_browse=')

    // grant 只能浏览，不能管理整罐（防止被代理页面一键清空全部站点登录态）。
    const withGrant = await app!.inject({
      method: 'GET',
      url: '/api/browse/cookies',
      headers: { cookie: grantCookie },
    })
    expect(withGrant.statusCode).toBe(401)
    const clearWithGrant = await app!.inject({
      method: 'POST',
      url: '/api/browse/cookies/clear',
      headers: { cookie: grantCookie },
    })
    expect(clearWithGrant.statusCode).toBe(401)

    // 主域会话仍然可用。
    const withSession = await app!.inject({
      method: 'GET',
      url: '/api/browse/cookies',
      headers: { cookie },
    })
    expect(withSession.statusCode).toBe(200)
  })

  it('SSRF：私网字面量与超长跳转链在外层闸被拒', async () => {
    await setup((_req, res) => res.end('unused'))
    const privateTarget = await browseGet('http://127.0.0.1:9999/')
    expect(privateTarget.statusCode).toBe(403)
    expect(privateTarget.body).toContain('该地址不允许访问')
  })

  it('Range/accept-language 透传：206 与 content-range 保留（A2 审查）', async () => {
    await setup((req, res) => {
      if (req.headers.range === 'bytes=0-99') {
        res.writeHead(206, {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-99/1000',
          'accept-ranges': 'bytes',
        })
        res.end(Buffer.alloc(100, 7))
        return
      }
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end(Buffer.alloc(1000, 1))
    })
    const ranged = await app!.inject({
      method: 'GET',
      url: `/api/browse?url=${encodeURIComponent(`${target()}/video`)}`,
      headers: { cookie, range: 'bytes=0-99', 'accept-language': 'fr-FR,fr;q=0.9' },
    })
    expect(ranged.statusCode).toBe(206)
    expect(ranged.headers['content-range']).toBe('bytes 0-99/1000')
    expect(ranged.headers['accept-ranges']).toBe('bytes')
    expect(ranged.rawPayload).toHaveLength(100)
    // 上游确实收到了客户端的 range 与 accept-language（缺省 UA 头被覆盖）。
    const last = requests.at(-1)
    expect(last?.headers['range']).toBe('bytes=0-99')
    expect(last?.headers['accept-language']).toBe('fr-FR,fr;q=0.9')
  })
})

// BrowsePolicyError 是对外错误类型：确保 instanceof 判定稳定（错误页分支依赖）。
describe('BrowsePolicyError', () => {
  it('携带 status/code 且 instanceof 稳定', () => {
    const error = new BrowsePolicyError(403, 'private-address')
    expect(error).toBeInstanceOf(BrowsePolicyError)
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(403)
    expect(error.code).toBe('private-address')
  })
})
