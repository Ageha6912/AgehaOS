import { afterEach, describe, expect, it, vi } from 'vitest'

import { BROWSE_PRELUDE_SCRIPT } from '../src/browse/prelude'
import { decodeBrowsePath, encodeBrowsePath, isBrowsePath } from '../src/browse/path-codec'
import { signGrant, verifyGrant } from '../src/browse/grant'
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

  it('isBrowsePath：首段为 scheme 才算', () => {
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
    const token = signGrant(SECRET, 'user-1', 60_000, NOW)
    expect(verifyGrant(SECRET, token, NOW + 1)).toBe('user-1')
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0] as string, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['exp', 'u'])
  })

  it('篡改/过期/畸形/换密钥一律 null', () => {
    const token = signGrant(SECRET, 'user-1', 60_000, NOW)
    expect(verifyGrant(SECRET, token, NOW + 60_001)).toBeNull() // 过期
    expect(verifyGrant('other', token, NOW)).toBeNull() // 换密钥
    expect(verifyGrant(SECRET, `${token}x`, NOW)).toBeNull() // 签名篡改
    expect(verifyGrant(SECRET, 'garbage', NOW)).toBeNull()
    expect(verifyGrant(SECRET, 'a.b', NOW)).toBeNull()
    const forged = Buffer.from(JSON.stringify({ u: 'x', exp: NOW + 1 })).toString('base64url')
    expect(verifyGrant(SECRET, `${forged}.AAAA`, NOW)).toBeNull() // 伪造载荷无签名
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
    // eslint-disable-next-line no-new-func
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
    options: { contentType?: string; bytes?: number[] } = {},
  ): FakeRequest {
    return {
      url,
      method,
      headers: {
        get: (name: string) => (name === 'content-type' ? (options.contentType ?? null) : null),
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
    // eslint-disable-next-line no-new-func
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

  it('路径态请求（导航/链接）直接换算 /raw 目标', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const { listeners } = loadWorker(new Map())

    const promise = runFetch(
      listeners,
      makeRequest('https://browse.local/https/example.com/a/b?q=1'),
    )
    expect(promise).toBeDefined()
    await promise
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/raw/https/example.com/a/b?q=1')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
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

  it('POST 携带原始体与 content-type（表单/上传经 SW 到 /raw）', async () => {
    const fetchStub = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    vi.stubGlobal('fetch', fetchStub)
    const { listeners } = loadWorker(new Map())

    await runFetch(
      listeners,
      makeRequest('https://browse.local/https/example.com/login', 'POST', {
        contentType: 'application/x-www-form-urlencoded',
        bytes: [97, 61, 49],
      }),
    )
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/raw/https/example.com/login')
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
