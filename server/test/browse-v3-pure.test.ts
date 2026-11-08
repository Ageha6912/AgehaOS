import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { BROWSE_CLICK_GUARD_SCRIPT, BROWSE_PRELUDE_SCRIPT } from '../src/browse/prelude'
import { decodeBrowsePath, encodeBrowsePath, isBrowsePath } from '../src/browse/path-codec'
import { BROWSE_GRANT_TTL_MS, CLAIM_TOKEN_TTL_MS, signGrant, verifyGrant } from '../src/browse/grant'
import { browseSwSource } from '../src/browse/sw-source'

/**
 * 档 ③ 纯模块：路径编码往返、授权令牌验签、存储前奏与 Service Worker 源码的
 * **真实求值**测试（测的就是将要下发的字节，不是等价重写）。
 */

describe('path-codec（路径态编码）', () => {
  it('encode：http(s) 原样入路径（含端口/查询/编码字符）', () => {
    expect(encodeBrowsePath('https://example.com/')).toBe('/https/example.com/')
    expect(encodeBrowsePath('https://example.com/a/b?c=1&d=%20x')).toBe(
      '/https/example.com/a/b?c=1&d=%20x',
    )
    expect(encodeBrowsePath('http://localhost:8787/x')).toBe('/http/localhost:8787/x')
    expect(encodeBrowsePath('https://example.com')).toBe('/https/example.com/')
  })

  it('encode：非法输入与非 http(s) 拒绝', () => {
    expect(encodeBrowsePath('not a url')).toBeNull()
    expect(encodeBrowsePath('ftp://example.com/')).toBeNull()
    expect(encodeBrowsePath('javascript:alert(1)')).toBeNull()
  })

  it('decode 往返一致；点段被归一化', () => {
    const targets = [
      'https://example.com/',
      'https://example.com/a/b?c=1&d=2',
      'http://localhost:8787/raw',
      'https://xn--fiqs8s.example/%E4%B8%AD%E6%96%87/a',
    ]
    for (const target of targets) {
      const path = encodeBrowsePath(target)!
      const [pathname, search] = path.split(/(?=\?)/) as [string, string?]
      expect(decodeBrowsePath(pathname, search ?? '')).toBe(new URL(target).toString())
    }
    // 点段在 URL 归一化中被吃掉（安全行为）。
    expect(decodeBrowsePath('/https/example.com/a/../b', '')).toBe('https://example.com/b')
  })

  it('decode：缺段/scheme 非法/host 空 → null', () => {
    expect(decodeBrowsePath('/', '')).toBeNull()
    expect(decodeBrowsePath('/https', '')).toBeNull()
    expect(decodeBrowsePath('/https/', '')).toBeNull()
    expect(decodeBrowsePath('/ftp/example.com/', '')).toBeNull()
    expect(decodeBrowsePath('/raw/https/example.com/', '')).toBeNull() // /raw 剥前缀后才是路径态
  })

  it('isBrowsePath：首段为 scheme 才算（/http 保留为兼容旧链接）', () => {
    expect(isBrowsePath('/https/example.com/')).toBe(true)
    expect(isBrowsePath('/http/x/')).toBe(true)
    expect(isBrowsePath('/raw/https/example.com/')).toBe(false)
    expect(isBrowsePath('/api/browse')).toBe(false)
    expect(isBrowsePath('/')).toBe(false)
  })
})

describe('grant（子域授权令牌）', () => {
  const SECRET = 'test-secret'
  const NOW = 1_700_000_000_000

  it('签验往返；载荷只含 userId 与过期时间', () => {
    const token = signGrant(SECRET, 'user-1', 60_000, NOW, 'browse')
    expect(verifyGrant(SECRET, token, NOW + 1, 'browse')).toBe('user-1')
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0] as string, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['exp', 's', 'u'])
  })

  it('篡改/过期/畸形/换密钥一律 null', () => {
    const token = signGrant(SECRET, 'user-1', 60_000, NOW, 'browse')
    expect(verifyGrant(SECRET, token, NOW + 60_001, 'browse')).toBeNull() // 过期
    expect(verifyGrant('other', token, NOW, 'browse')).toBeNull() // 换密钥
    expect(verifyGrant(SECRET, `${token}x`, NOW, 'browse')).toBeNull() // 签名篡改
    expect(verifyGrant(SECRET, 'garbage', NOW, 'browse')).toBeNull()
    expect(verifyGrant(SECRET, 'a.b', NOW, 'browse')).toBeNull()
    const forged = Buffer.from(JSON.stringify({ u: 'x', exp: NOW + 1 })).toString('base64url')
    expect(verifyGrant(SECRET, `${forged}.AAAA`, NOW, 'browse')).toBeNull() // 伪造载荷无签名
  })

  it('用途域互斥：claim 令牌当 browse cookie 用（或反之）一律 null（A2 审查）', () => {
    const claim = signGrant(SECRET, 'user-1', CLAIM_TOKEN_TTL_MS, NOW, 'claim')
    const browse = signGrant(SECRET, 'user-1', BROWSE_GRANT_TTL_MS, NOW, 'browse')
    expect(verifyGrant(SECRET, claim, NOW, 'browse')).toBeNull()
    expect(verifyGrant(SECRET, browse, NOW, 'claim')).toBeNull()
    expect(verifyGrant(SECRET, claim, NOW, 'claim')).toBe('user-1')
    expect(verifyGrant(SECRET, browse, NOW, 'browse')).toBe('user-1')
    // 旧版载荷（无 s 字段）拒绝——升级后历史 grant 全部失效，浏览器重新引导即可。
    const legacyPayload = Buffer.from(JSON.stringify({ u: 'user-1', exp: NOW + 1 })).toString('base64url')
    const legacySig = createHmac('sha256', SECRET).update(legacyPayload).digest().toString('base64url')
    expect(verifyGrant(SECRET, `${legacyPayload}.${legacySig}`, NOW, 'browse')).toBeNull()
  })
})

describe('BROWSE_PRELUDE_SCRIPT（存储命名空间前奏，真实求值）', () => {
  function makeStorage(): Storage {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } as Storage
  }

  function evaluate(pathname: string): {
    window: Record<string, unknown> & { localStorage: Storage; sessionStorage: Storage }
    realLocal: Storage
  } {
    const realLocal = makeStorage()
    const realSession = makeStorage()
    const windowStub: Record<string, unknown> = {
      localStorage: realLocal,
      sessionStorage: realSession,
    }
    const locationStub = { pathname }
    // 真实求值下发的字节（prelude 通过 defineProperty 覆盖两个存储）。
    new Function('window', 'location', BROWSE_PRELUDE_SCRIPT)(windowStub, locationStub)
    return {
      window: windowStub as never,
      realLocal,
    }
  }

  it('页面视角读写被命名空间化到 ax:scheme:host: 前缀（真实存储可见）', () => {
    const { window, realLocal } = evaluate('/https/example.com/a')
    const local = window.localStorage as Storage
    expect((window as { __agehaBrowseSite?: string }).__agehaBrowseSite).toBe('https://example.com')

    local.setItem('token', 'abc')
    expect(realLocal.getItem('ax:https:example.com:token')).toBe('abc')
    expect(local.getItem('token')).toBe('abc')
    expect(local.length).toBe(1)
    expect(local.key(0)).toBe('token')

    local.removeItem('token')
    expect(realLocal.getItem('ax:https:example.com:token')).toBeNull()
  })

  it('两站点隔离：不同 host 前缀互不可见；clear 只清自己的键', () => {
    const siteA = evaluate('/https/a.example/x')
    const storage = siteA.window.localStorage as Storage
    // 直接向真实存储预置另一站点的键（模拟先访问 b.example 留下的数据）。
    siteA.realLocal.setItem('ax:https:b.example:secret', 'b-data')
    storage.setItem('mine', '1')

    expect(storage.getItem('secret')).toBeNull() // 读不到 b 的
    expect(storage.length).toBe(1)
    storage.clear()
    expect(storage.length).toBe(0)
    expect(siteA.realLocal.getItem('ax:https:b.example:secret')).toBe('b-data') // 未误删
  })

  it('单侧 wrap 抛错时该侧回退真实 Storage，页面调用不再 TypeError（A2 审查）', () => {
    const realLocal = makeStorage()
    // sessionStorage 缺 removeItem：wrap(sessionStorage) 抛 TypeError。
    const brokenSession = makeStorage() as unknown as Record<string, unknown>
    delete brokenSession.removeItem
    const windowStub: Record<string, unknown> = {
      localStorage: realLocal,
      sessionStorage: brokenSession,
    }
    new Function('window', 'location', BROWSE_PRELUDE_SCRIPT)(windowStub, { pathname: '/https/example.com/a' })
    // localStorage 侧仍被命名空间化。
    const local = windowStub.localStorage as Storage
    local.setItem('k', 'v')
    expect(realLocal.getItem('ax:https:example.com:k')).toBe('v')
    // sessionStorage 侧回退真实对象（旧实现返回 undefined.__agehaRealSession）。
    const session = windowStub.sessionStorage as {
      getItem: (key: string) => string | null
      setItem: (key: string, value: string) => void
    }
    expect(typeof session.getItem).toBe('function')
    session.setItem('s', '1')
    expect(session.getItem('s')).toBe('1')
  })
})

describe('BROWSE_CLICK_GUARD_SCRIPT（点击守卫，真实求值）', () => {
  interface Harness {
    click: (attrs: { target?: string; href?: string } | null) => {
      prevented: boolean
      posted: unknown[]
      href: string
    }
  }

  function setup(): Harness {
    const listeners: Record<string, (event: unknown) => void> = {}
    const posted: unknown[] = []
    const locationStub = {
      pathname: '/https/example.com/',
      href: 'https://browse.local/https/example.com/',
      search: '',
    }
    const documentStub = {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners[type] = handler
      },
    }
    const windowStub = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setTimeout: () => 0,
    }
    const parentStub = { postMessage: (message: unknown) => posted.push(message) }
    new Function('document', 'window', 'parent', 'location', 'URL', BROWSE_CLICK_GUARD_SCRIPT)(
      documentStub,
      windowStub,
      parentStub,
      locationStub,
      URL,
    )

    return {
      click(attrs) {
        const anchor =
          attrs === null
            ? null
            : {
                getAttribute: (name: string) =>
                  name === 'target' ? (attrs.target ?? null) : (attrs.href ?? null),
              }
        let prevented = false
        listeners.click?.({
          target: { closest: () => anchor },
          preventDefault: () => {
            prevented = true
          },
        })
        return { prevented, posted, href: locationStub.href }
      },
    }
  }

  it('_blank 链接：拦下并请求宿主在新标签页打开（真实 URL，路径态换算回站点）', () => {
    const harness = setup()
    const result = harness.click({ target: '_blank', href: '//www.bilibili.com/video/BV1?t=1' })
    expect(result.prevented).toBe(true)
    expect(result.posted).toEqual([
      { type: 'agehaos:open-external', url: 'https://www.bilibili.com/video/BV1?t=1' },
    ])
    // 宿主未回执时不在此刻同帧导航（setTimeout 兜底由真实浏览器验证）。
    expect(result.href).toBe('https://browse.local/https/example.com/')
  })

  it('_self/缺 target/锚点不拦（站点自身手势）', () => {
    const harness = setup()
    for (const attrs of [
      { target: '_self', href: '/x' },
      { href: '/x' },
      { target: '_blank', href: '#section' },
      { target: '_blank' },
    ]) {
      expect(harness.click(attrs as never).prevented).toBe(false)
    }
    expect(harness.click(null).prevented).toBe(false)
  })
})

describe('browseSwSource（SW 源码真实求值）', () => {
  interface FakeRequest {
    url: string
    method: string
    headers: { get: (name: string) => string | null }
    arrayBuffer: () => Promise<ArrayBuffer>
    tag: string
  }

  function makeRequest(
    url: string,
    method = 'GET',
    options: { contentType?: string; bytes?: number[]; headers?: Record<string, string> } = {},
  ): FakeRequest {
    const headerMap = new Map<string, string>(
      Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    )
    if (options.contentType !== undefined) headerMap.set('content-type', options.contentType)
    return {
      url,
      method,
      headers: {
        get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      },
      arrayBuffer: async () => new Uint8Array(options.bytes ?? []).buffer as ArrayBuffer,
      tag: `${method} ${url}`,
    }
  }

  function loadWorker(clients: Map<string, { url: string }>) {
    const listeners = new Map<string, (event: unknown) => void>()
    const swSelf = {
      location: { origin: 'https://browse.local' },
      skipWaiting: vi.fn(),
      clients: {
        claim: vi.fn(),
        get: async (id: string) => clients.get(id) ?? null,
      },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler)
      },
    }
    new Function('self', browseSwSource())(swSelf)
    return { listeners, swSelf }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function runFetch(
    listeners: Map<string, (event: unknown) => void>,
    request: FakeRequest,
    clientId: string | null = null,
  ): Promise<unknown> | undefined {
    let captured: Promise<unknown> | undefined
    const event = {
      request,
      clientId,
      respondWith: (promise: Promise<unknown>) => {
        captured = promise
      },
    }
    listeners.get('fetch')?.(event)
    return captured
  }

  it('install/activate 注册且 take-over（skipWaiting + claim）', () => {
    const { listeners, swSelf } = loadWorker(new Map())
    expect(listeners.has('install')).toBe(true)
    expect(listeners.has('fetch')).toBe(true)
    const waits: Array<Promise<unknown>> = []
    listeners.get('activate')?.({
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    })
    expect(swSelf.skipWaiting).toBeDefined()
    expect(swSelf.clients.claim).toHaveBeenCalled()
    expect(waits).toHaveLength(1)
  })

  it('跨域与基础设施前缀（/raw、/sw.js、/__*）放行不拦截', () => {
    const fetchStub = vi.fn()
    vi.stubGlobal('fetch', fetchStub)
    const { listeners } = loadWorker(new Map())
    for (const url of [
      'https://other.example/x',
      'https://browse.local/raw/https/example.com/a',
      'https://browse.local/sw.js',
      'https://browse.local/__bootstrap',
    ]) {
      expect(runFetch(listeners, makeRequest(url))).toBeUndefined()
    }
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('路径态导航放行（不二次换算；防 /video/x 丢 host）', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const { listeners } = loadWorker(new Map())
    // 已是路径态的导航：respondWith 不应被调用（浏览器直接请求服务端路由）。
    expect(
      runFetch(listeners, makeRequest('https://browse.local/https/www.bilibili.com/video/BV1')),
    ).toBeUndefined()
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('路径态请求（导航/链接）直接换算 /raw 目标', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)

    // 路径态导航本身放行（由服务端路由渲染）；页面内同源请求按基准换算。
    const clients = new Map([['c1', { url: 'https://browse.local/https/example.com/a/b?q=1' }]])
    const scoped = loadWorker(clients)
    await runFetch(scoped.listeners, makeRequest('https://browse.local/assets/app.js?q=1'), 'c1')
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/raw/https/example.com/assets/app.js?q=1')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('头透传白名单：range/accept-language/content-type 转发，凭据头绝不转发（A2 审查）', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const clients = new Map([['c1', { url: 'https://browse.local/https/example.com/a' }]])
    const scoped = loadWorker(clients)
    await runFetch(
      scoped.listeners,
      makeRequest('https://browse.local/video.mp4', 'GET', {
        contentType: 'video/mp4',
        headers: {
          range: 'bytes=100-199',
          'accept-language': 'fr-FR,fr;q=0.9',
          authorization: 'Bearer secret',
          'if-none-match': '"etag-1"',
        },
      }),
      'c1',
    )
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('video/mp4')
    expect(headers.range).toBe('bytes=100-199')
    expect(headers['accept-language']).toBe('fr-FR,fr;q=0.9')
    expect(headers.authorization).toBeUndefined()
    // if-* 有意不转：代理管道恒 no-store，304 会让 HTML 重写拿到空 body。
    expect(headers['if-none-match']).toBeUndefined()
  })

  it('页面内相对请求：按客户端当前文档的目标解析基准', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const clients = new Map([
      ['c1', { url: 'https://browse.local/https/example.com/app/page?x=2' }],
    ])
    const { listeners } = loadWorker(clients)

    await runFetch(listeners, makeRequest('https://browse.local/api/data?n=3'), 'c1')
    const [url] = fetchStub.mock.calls[0] as [string]
    expect(url).toBe('/raw/https/example.com/api/data?n=3')

    // 根相对路径同样按目标源解析。
    await runFetch(listeners, makeRequest('https://browse.local/assets/app.js'), 'c1')
    expect((fetchStub.mock.calls[1] as [string])[0]).toBe('/raw/https/example.com/assets/app.js')
  })

  it('http 目标升级 https 再拼 /raw（混合内容防护）', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const clients = new Map([['c9', { url: 'https://browse.local/https/example.com/a' }]])
    const { listeners } = loadWorker(clients)

    await runFetch(listeners, makeRequest('https://browse.local/api/x'), 'c9')
    // 基准是 https 目标 → /raw/https。
    expect((fetchStub.mock.calls[0] as [string])[0]).toBe('/raw/https/example.com/api/x')
  })

  it('POST 携带原始体与 content-type（表单/上传经 SW 到 /raw）', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)

    const clients = new Map([['c2', { url: 'https://browse.local/https/example.com/login' }]])
    const scoped = loadWorker(clients)
    await runFetch(
      scoped.listeners,
      makeRequest('https://browse.local/submit', 'POST', {
        contentType: 'application/x-www-form-urlencoded',
        bytes: [97, 61, 49],
      }),
      'c2',
    )
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/raw/https/example.com/submit')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    )
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(new Uint8Array([97, 61, 49]))
  })

  it('无从解析基准（无 clientId / 客户端非路径态）→ 原样放行', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const { listeners } = loadWorker(new Map([['c2', { url: 'https://browse.local/sw.js' }]]))

    const request = makeRequest('https://browse.local/api/data')
    await runFetch(listeners, request, null)
    expect(fetchStub).toHaveBeenLastCalledWith(request)

    await runFetch(listeners, request, 'c2')
    expect(fetchStub).toHaveBeenLastCalledWith(request)
  })
})
