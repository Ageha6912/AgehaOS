import { createServer, type Server, type ServerResponse } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app'
import { BROWSE_COOKIE, signGrant } from '../src/browse/grant'
import { MemoryDataStore } from '../src/store/memory-store'

/**
 * 档 ③ 服务端集成：路径态文档（/https）、SW 数据通道（/raw）、子域自举
 * （/__bootstrap + /__claim + /sw.js）与双通道鉴权（主域会话 / 子域 grant）。
 */

interface Recorded {
  headers: IncomingHttpHeaders
  url: string
  method: string
  body: Buffer
}

interface Upstream {
  server: Server
  port: number
  requests: Recorded[]
}

function startUpstream(respond: (req: Recorded, res: ServerResponse) => void): Promise<Upstream> {
  const requests: Recorded[] = []
  const server = createServer((incoming, res) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const record: Recorded = {
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

const TOKEN_SECRET = 'test-browse-secret'

describe('/https · /raw · 子域自举（档 ③）', () => {
  let app: FastifyInstance | null = null
  let upstream: Server | null = null
  let upstreamPort = 0
  let requests: Recorded[] = []
  let cookie = ''

  afterEach(async () => {
    await app?.close()
    upstream?.close()
    app = null
    upstream = null
  })

  async function setup(respond: (req: Recorded, res: ServerResponse) => void): Promise<void> {
    const handle = await startUpstream(respond)
    upstream = handle.server
    upstreamPort = handle.port
    requests = handle.requests
    app = await buildApp({
      store: new MemoryDataStore(),
      config: { store: 'memory', rateLimit: { loginMax: 100, registerMax: 100, windowMs: 60_000 } },
      browse: {
        resolveHost: async () => ['93.184.216.34'],
        allowedPorts: new Set(['', '80', '443', String(upstreamPort)]),
        tokenSecret: TOKEN_SECRET,
        cookieSecure: false,
      },
    })
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'v3-user', password: 'secret1' },
    })
    expect(registered.statusCode).toBe(201)
    const setCookie = registered.headers['set-cookie']
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? ''
  }

  /** 上游页面的路径态形态（http 段）。 */
  function pathOf(path: string): string {
    return `/http/localhost:${upstreamPort}${path}`
  }

  const HTML_PAGE =
    '<html><head><title>t</title></head><body><a href="/next">n</a><form action="/go" method="post"><input name="q"></form></body></html>'

  it('路径态文档：链接/表单产出路径态、base 注入、存储前奏注入', async () => {
    await setup((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HTML_PAGE)
    })

    const response = await app!.inject({
      method: 'GET',
      url: pathOf('/page'),
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(`href="${pathOf('/next')}"`)
    expect(response.body).toContain(`action="${pathOf('/go')}"`)
    // 路径模式不注入 base：页面相对 URL 必须按文档真实地址（browse 路径态）
    // 解析并经 SW 回流——注入 base 会劫持页面 JS 的相对请求去真实站点
    // （跨域 CORS 全灭，2026-10-18 冒烟实证）。
    expect(response.body).not.toContain('<base')
    expect(response.body).toContain('__agehaBrowseSite') // 存储命名空间前奏
    expect(response.body).toContain('method="post"') // 方法原样
  })

  it('/raw 数据通道：与路径态同逻辑；非 HTML 透传', async () => {
    await setup((req, res) => {
      if (req.url === '/pic.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(HTML_PAGE)
    })

    const doc = await app!.inject({
      method: 'GET',
      url: `/raw${pathOf('/page')}`,
      headers: { cookie },
    })
    expect(doc.statusCode).toBe(200)
    expect(doc.body).toContain(`href="${pathOf('/next')}"`)

    const png = await app!.inject({
      method: 'GET',
      url: `/raw${pathOf('/pic.png')}`,
      headers: { cookie },
    })
    expect(png.statusCode).toBe(200)
    expect(png.headers['content-type']).toBe('image/png')
    expect(png.rawPayload[0]).toBe(0x89)
  })

  it('POST 路径态表单：原始体转发', async () => {
    await setup((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body>got:${req.body.toString('utf8')}</body></html>`)
    })
    const response = await app!.inject({
      method: 'POST',
      url: pathOf('/go'),
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'q=hello',
    })
    expect(response.statusCode).toBe(200)
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.body.toString('utf8')).toBe('q=hello')
    expect(response.body).toContain('got:q=hello')
  })

  it('令牌链：主域签发 → /__claim 换子域 httpOnly cookie → 仅凭子域 cookie 走 /https', async () => {
    await setup((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(HTML_PAGE)
    })

    // ① 主域（会话门）签发领取令牌。
    const tokenResponse = await app!.inject({
      method: 'GET',
      url: '/api/browse/token',
      headers: { cookie },
    })
    expect(tokenResponse.statusCode).toBe(200)
    const { token } = tokenResponse.json() as { token: string }
    expect(typeof token).toBe('string')

    // ② 子域引导页 claim：换回 httpOnly browse cookie。
    const claimed = await app!.inject({
      method: 'POST',
      url: '/__claim',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ token }),
    })
    expect(claimed.statusCode).toBe(200)
    const grantCookie = claimed.headers['set-cookie']
    const grant = String(Array.isArray(grantCookie) ? grantCookie[0] : grantCookie)
    expect(grant).toContain(`${BROWSE_COOKIE}=`)
    expect(grant).toContain('HttpOnly')

    // ③ 仅凭子域 cookie（无主域会话）访问路径态文档。
    const browseOnly = grant.split(';')[0] ?? ''
    const viaGrant = await app!.inject({
      method: 'GET',
      url: pathOf('/page'),
      headers: { cookie: browseOnly },
    })
    expect(viaGrant.statusCode).toBe(200)

    // ④ 伪造/篡改的 grant 一律 401（验签失败）。
    const forged = await app!.inject({
      method: 'GET',
      url: pathOf('/page'),
      headers: { cookie: `${BROWSE_COOKIE}=bogus.payload` },
    })
    expect(forged.statusCode).toBe(401)

    // ⑤ 过期令牌 claim 400；坏体 400。
    const expired = signGrant(TOKEN_SECRET, 'u1', -1000, Date.now() - 2000)
    expect(
      (
        await app!.inject({
          method: 'POST',
          url: '/__claim',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ token: expired }),
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app!.inject({
          method: 'POST',
          url: '/__claim',
          headers: { 'content-type': 'application/json' },
          payload: 'not-json',
        })
      ).statusCode,
    ).toBe(400)

    // ⑥ token 端点未登录 401（claim 令牌不能由 grant 续签：grant 通道拿不到）。
    const anon = await app!.inject({ method: 'GET', url: '/api/browse/token' })
    expect(anon.statusCode).toBe(401)
    const grantOnlyToken = await app!.inject({
      method: 'GET',
      url: '/api/browse/token',
      headers: { cookie: browseOnly },
    })
    expect(grantOnlyToken.statusCode).toBe(401)
  })

  it('自举资源：/sw.js（正确的 content-type 与 scope 头）与 /__bootstrap（引导页）', async () => {
    await setup((_req, res) => res.end('unused'))

    const sw = await app!.inject({ method: 'GET', url: '/sw.js' })
    expect(sw.statusCode).toBe(200)
    expect(sw.headers['content-type']).toContain('text/javascript')
    expect(sw.headers['service-worker-allowed']).toBe('/')
    expect(sw.body).toContain("addEventListener('fetch'")
    expect(sw.body).toContain("'/raw/'")

    const bootstrap = await app!.inject({ method: 'GET', url: '/__bootstrap' })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.headers['content-type']).toContain('text/html')
    expect(bootstrap.body).toContain('agehaos:browse-ready')
    expect(bootstrap.body).toContain('/__claim')
  })

  it('路径态非法目标（缺段/坏 scheme）→ 400 错误页', async () => {
    await setup((_req, res) => res.end('unused'))
    const response = await app!.inject({ method: 'GET', url: '/https/', headers: { cookie } })
    expect(response.statusCode).toBe(400)
    expect(response.body).toContain('缺少地址')
  })
})
