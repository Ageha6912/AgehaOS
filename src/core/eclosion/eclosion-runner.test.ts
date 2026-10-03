import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

/**
 * eclosion-runner（public/apps/runtime/eclosion-runner.js，生产内联进 eclosion.html）
 * 的行为测试：每个用例在独立 JSDOM 窗口里执行 runner 源码，窗口即「宿主 parent」，
 * postMessage 以 spy 截获，宿主→runner 的消息以 MessageEvent（source=该窗口）注入。
 * 脚本注入在 outside-only 模式不执行——执行链路由 e2e/eclosion-runtime.spec.ts 在真实
 * Chromium 里验证。
 *
 * 注意：vitest jsdom 环境里 import.meta.url 不是 file: 协议，文件读取走
 * process.cwd() 相对路径（套件从仓库根运行）。
 */

const RUNNER_SRC = readFileSync(resolve('public/apps/runtime/eclosion-runner.js'), 'utf8')

/** power-on 的能力声明（宿主必带；runner 严格校验形状）。 */
const CAPS = { apis: ['theme'] } as const
const CAPS_FULL = { apis: ['theme', 'storage', 'files'] } as const

interface Posted {
  type: string
  message?: string
  reqId?: string
  api?: string
  action?: string
  params?: Record<string, unknown>
}

function bootRunner(bodyHtml = '<div id="eclosion-root"></div>') {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    url: 'http://localhost/apps/runtime/eclosion-runner.test.html',
  })
  const win = dom.window
  const posted: Posted[] = []
  const spy = vi.spyOn(win, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as Posted)
  })
  win.eval(RUNNER_SRC)
  const sendFromHost = (data: unknown) => {
    win.dispatchEvent(new win.MessageEvent('message', { data, source: win as unknown as Window }))
  }
  return { win, posted, spy, sendFromHost }
}

describe('eclosion-runner：§4.2 协议行为', () => {
  it('posts agehaos:ready on load', () => {
    const { posted, spy } = bootRunner()
    expect(posted).toEqual([{ type: 'agehaos:ready' }])
    // 就绪消息发给 parent。
    expect(spy.mock.instances.length).toBeGreaterThanOrEqual(1)
  })

  it('mounts chunk content into #eclosion-root with <template> and injects the pop style', () => {
    const { win, posted, sendFromHost } = bootRunner()
    sendFromHost({ type: 'eclosion:chunk', seq: 0, html: '<style>.a{color:red}</style>' })
    sendFromHost({ type: 'eclosion:chunk', seq: 1, html: '<p class="a">第一片</p><button>点</button>' })

    const root = win.document.getElementById('eclosion-root')
    expect(root).not.toBeNull()
    expect(root?.querySelector('style')?.textContent).toBe('.a{color:red}')
    expect(root?.querySelectorAll('p, button').length).toBe(2)
    // pop 动画样式注入一次，且带 prefers-reduced-motion 降级（坑 71）。
    const pop = win.document.getElementById('eclosion-pop-style')
    expect(pop).not.toBeNull()
    expect(pop?.textContent).toContain('eclosion-pop')
    expect(pop?.textContent).toContain('prefers-reduced-motion')
    // 尚未破茧：不应有 rendered，也不应有任何 script 元素。
    expect(posted.some((m) => m.type === 'eclosion:rendered')).toBe(false)
    expect(win.document.querySelectorAll('script').length).toBe(0)
  })

  it('drops duplicate / out-of-order / malformed chunks', () => {
    const { win, sendFromHost } = bootRunner()
    sendFromHost({ type: 'eclosion:chunk', seq: 0, html: '<p>0</p>' })
    sendFromHost({ type: 'eclosion:chunk', seq: 0, html: '<p>重复</p>' }) // 重复
    sendFromHost({ type: 'eclosion:chunk', seq: 3, html: '<p>跳号</p>' }) // 跳号仍接受（保序传输下不会发生）
    sendFromHost({ type: 'eclosion:chunk', seq: 1, html: '<p>迟到</p>' }) // 序号倒退：丢弃
    sendFromHost({ type: 'eclosion:chunk', seq: 2, html: 42 }) // 坏类型：丢弃
    sendFromHost({ type: 'eclosion:chunk', seq: 2, html: '<p>2</p>', extra: 1 }) // 多余字段：丢弃
    const root = win.document.getElementById('eclosion-root')
    expect(root?.children.length).toBe(2)
    expect(root?.textContent).toContain('0')
    expect(root?.textContent).not.toContain('重复')
    expect(root?.textContent).not.toContain('迟到')
  })

  it('injects withheld scripts in order on power-on and posts eclosion:rendered', () => {
    const { win, posted, sendFromHost } = bootRunner()
    sendFromHost({ type: 'eclosion:chunk', seq: 0, html: '<p id="host">骨架</p>' })
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var first = 1', 'var second = 2'], capabilities: CAPS })

    const scripts = Array.from(win.document.querySelectorAll('script'))
    expect(scripts.map((s) => s.textContent)).toEqual(['var first = 1', 'var second = 2'])
    // 注入到 body（root 之外——骨架不动，脚本按序追加）。
    expect(win.document.body.contains(scripts[0])).toBe(true)
    expect(posted.some((m) => m.type === 'eclosion:rendered')).toBe(true)
  })

  it('power-on is idempotent: a second power-on does not re-inject or re-report', () => {
    const { win, posted, sendFromHost } = bootRunner()
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var a = 1'], capabilities: CAPS })
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var b = 2'], capabilities: CAPS })
    sendFromHost({ type: 'eclosion:chunk', seq: 0, html: '<p>破茧后的片</p>' })
    expect(win.document.querySelectorAll('script').length).toBe(1)
    expect(posted.filter((m) => m.type === 'eclosion:rendered')).toHaveLength(1)
    expect(win.document.getElementById('eclosion-root')?.textContent).toBe('')
  })

  it('drops power-on with malformed scripts / capabilities and unknown message types', () => {
    const { win, posted, sendFromHost } = bootRunner()
    sendFromHost({ type: 'eclosion:power-on', scripts: 'var a', capabilities: CAPS }) // 非数组
    sendFromHost({ type: 'eclosion:power-on', scripts: [1], capabilities: CAPS }) // 非字符串成员
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var a = 1'], run: 'now' }) // 缺 capabilities + 多余字段
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var a = 1'], capabilities: {} }) // 缺 apis
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var a = 1'], capabilities: { apis: [] } }) // 空
    sendFromHost({ type: 'eclosion:power-on', scripts: ['var a = 1'], capabilities: { apis: ['theme', 'user'] } }) // user 不在羽化能力面
    sendFromHost({ type: 'eclosion:exec', code: 'x' }) // 未知类型
    sendFromHost(null)
    sendFromHost('eclosion:power-on')
    expect(win.document.querySelectorAll('script').length).toBe(0)
    expect(posted.some((m) => m.type === 'eclosion:rendered')).toBe(false)
  })

  it('ignores messages whose source is not the parent window (nested iframe forgery)', () => {
    const { win, posted } = bootRunner()
    const foreign = new JSDOM('<!doctype html><html><body></body></html>')
    win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'eclosion:power-on', scripts: ['window.__pwned = 1'], capabilities: CAPS }, source: foreign.window as unknown as Window }))
    expect(win.document.querySelectorAll('script').length).toBe(0)
    expect(win.eval('typeof window.__pwned')).toBe('undefined')
    expect(posted.some((m) => m.type === 'eclosion:rendered')).toBe(false)
  })

  it('reports window.onerror as eclosion:error and suppresses rendered for that power-on', () => {
    const { win, posted, sendFromHost } = bootRunner()
    // 破茧前脚本已报错 → 本次不回 rendered（§5.2 质量回退依据）。
    win.onerror?.('Uncaught Error: boom', 'eclosion.html', 12, 3, new Error('boom'))
    expect(posted.some((m) => m.type === 'eclosion:error' && String(m.message).includes('boom'))).toBe(true)
    sendFromHost({ type: 'eclosion:power-on', scripts: [], capabilities: CAPS })
    expect(posted.some((m) => m.type === 'eclosion:rendered')).toBe(false)
  })

  it('creates #eclosion-root when the host document lacks one', () => {
    const { win, sendFromHost } = bootRunner('')
    sendFromHost({ type: 'eclosion:chunk', seq: 0, html: '<p>自建根</p>' })
    expect(win.document.getElementById('eclosion-root')?.textContent).toBe('自建根')
  })
})

describe('eclosion-runner：window.AgehaOS SDK 客户端（§4.1 第 4 条）', () => {
  /** 破茧（scripts 留空——outside-only 模式注入的脚本不执行，直接调用客户端方法）。 */
  function powerOnWith(capabilities: unknown, scripts: string[] = []) {
    const ctx = bootRunner()
    ctx.sendFromHost({ type: 'eclosion:power-on', scripts, capabilities })
    return { ...ctx, sdk: ctx.win.AgehaOS as Record<string, unknown> | undefined }
  }

  const sdkRequestsOf = (posted: Posted[]) => posted.filter((m) => m.type === 'agehaos:sdk')

  it('installs AgehaOS at power-on, trimmed to the declared capabilities and frozen', () => {
    const before = bootRunner()
    expect((before.win as unknown as { AgehaOS?: unknown }).AgehaOS).toBeUndefined() // 破茧前不存在

    const { win, sdk } = powerOnWith(CAPS_FULL)
    expect(Object.keys(sdk ?? {}).sort()).toEqual(['files', 'storage', 'theme'])
    // 全部层级冻结（生成代码不得改写客户端伪装其它能力/应用）。
    expect(Object.isFrozen(sdk)).toBe(true)
    expect(Object.isFrozen(sdk?.storage)).toBe(true)
    expect(Object.isFrozen(sdk?.files)).toBe(true)

    const minimal = powerOnWith(CAPS)
    expect(Object.keys(minimal.sdk ?? {})).toEqual(['theme']) // 未授予的命名空间不存在
    expect((minimal.sdk as { storage?: unknown }).storage).toBeUndefined()
    expect(win.document.querySelectorAll('script').length).toBe(0) // scripts=[] 仍正常破茧
  })

  it('sends whitelisted sdk envelopes with reqId correlation and resolves on ok results', async () => {
    const { posted, sendFromHost, sdk } = powerOnWith(CAPS_FULL)
    const storage = sdk?.storage as {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<boolean>
      keys: () => Promise<string[]>
    }

    const written = storage.set('note-1', { text: '你好' })
    expect(sdkRequestsOf(posted)).toEqual([
      {
        type: 'agehaos:sdk',
        reqId: 'sdk-1',
        api: 'storage',
        action: 'set',
        params: { key: 'note-1', value: { text: '你好' } },
      },
    ])
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: {} })
    await expect(written).resolves.toBe(true)

    const read = storage.get('note-1')
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-2', ok: true, data: { value: { text: '你好' } } })
    await expect(read).resolves.toEqual({ text: '你好' })

    const keys = storage.keys()
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-3', ok: true, data: { keys: ['note-1'] } })
    await expect(keys).resolves.toEqual(['note-1'])

    const missing = storage.get('nope')
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-4', ok: true, data: { value: null } })
    await expect(missing).resolves.toBeNull()
  })

  it('propagates host errors as rejected promises carrying the host error code', async () => {
    const { sendFromHost, sdk } = powerOnWith(CAPS_FULL)
    const denied = (sdk?.storage as { get: (key: string) => Promise<unknown> }).get('k')
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: false, error: 'permission-denied' })
    await expect(denied).rejects.toThrow('permission-denied')
  })

  it('files client unwraps content / entries and coerces missing write content to empty string', async () => {
    const { posted, sendFromHost, sdk } = powerOnWith(CAPS_FULL)
    const files = sdk?.files as {
      read: (path: string) => Promise<string>
      write: (path: string, content?: string) => Promise<boolean>
      list: (path?: string) => Promise<Array<{ name: string; type: 'file' | 'directory' }>>
    }

    const read = files.read('a.txt')
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: { content: '第一篇' } })
    await expect(read).resolves.toBe('第一篇')

    void files.write('a.txt') // 缺 content → ''（与 Type C 客户端一致）
    expect(sdkRequestsOf(posted).at(-1)).toMatchObject({
      api: 'files',
      action: 'write',
      params: { path: 'a.txt', content: '' },
    })

    const list = files.list('')
    sendFromHost({
      type: 'agehaos:sdk-result',
      reqId: 'sdk-3',
      ok: true,
      data: { entries: [{ name: 'a.txt', type: 'file' }] },
    })
    await expect(list).resolves.toEqual([{ name: 'a.txt', type: 'file' }])
  })

  it('rejects with sdk-timeout when the host never replies (and ignores the late reply)', async () => {
    const { win, sendFromHost, sdk } = powerOnWith(CAPS_FULL)
    // 沙箱 realm 自己的定时器：截获回调手动触发（fake timers 管不到 jsdom window）。
    const timers: Array<() => void> = []
    const delays: number[] = []
    win.setTimeout = (((fn: () => void, ms?: number) => {
      timers.push(fn)
      delays.push(ms ?? 0)
      return timers.length
    }) as unknown) as typeof win.setTimeout

    const pending = (sdk?.storage as { get: (key: string) => Promise<unknown> }).get('k')
    expect(delays[0]).toBe(5000)
    timers[0]?.()
    await expect(pending).rejects.toThrow('sdk-timeout')

    // 超时后的迟到回执：reqId 已出 pending，静默丢弃（不产生二次拒绝）。
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: { value: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('drops malformed / stale / forged sdk-results without settling pending requests', async () => {
    const { win, posted, sendFromHost, sdk } = powerOnWith(CAPS_FULL)
    const storage = sdk?.storage as { get: (key: string) => Promise<unknown> }
    const pending = storage.get('k')

    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: {}, error: 'x' }) // 成功带 error
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: false }) // 失败缺 error
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: false, error: '' }) // 空 error
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'unknown-req', ok: true, data: { value: 1 } }) // 未知 reqId
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: {}, extra: 1 }) // 多余字段
    // 伪造来源（非 parent）：source 闸在 SDK 信封之前。
    win.dispatchEvent(
      new win.MessageEvent('message', {
        data: { type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: { value: 1 } },
        source: new JSDOM('<!doctype html>').window as unknown as Window,
      }),
    )
    expect(posted.some((m) => m.type === 'eclosion:error')).toBe(false) // 坏回执不触发 onerror

    // 之后同一请求的合法回执仍可兑现（坏回执未污染 pending）。
    sendFromHost({ type: 'agehaos:sdk-result', reqId: 'sdk-1', ok: true, data: { value: 'late-ok' } })
    await expect(pending).resolves.toBe('late-ok')
  })
})

describe('eclosion.html：内联副本与 CSP（§4.1）', () => {
  const RUNTIME_HTML = readFileSync(resolve('public/apps/runtime/eclosion.html'), 'utf8')

  it('inlines a byte-identical copy of eclosion-runner.js', () => {
    const match = /<script id="eclosion-runner">([\s\S]*?)<\/script>/.exec(RUNTIME_HTML)
    expect(match).not.toBeNull()
    // 剥掉开标签后的单个换行与收尾空白后必须与源文件逐字节一致。
    expect(match?.[1].replace(/^\r?\n/, '').trimEnd()).toBe(RUNNER_SRC.trimEnd())
    expect(RUNNER_SRC.trimEnd().length).toBeGreaterThan(1000)
  })

  it('never contains a literal </script sequence inside the runner source (would truncate the inline copy)', () => {
    expect(RUNNER_SRC.includes('</script')).toBe(false)
  })

  it('carries the exact §4.1 item-2 CSP and the mount root', () => {
    expect(RUNTIME_HTML).toContain('<div id="eclosion-root"></div>')
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(RUNTIME_HTML)?.[1]
    expect(csp).toBe(
      [
        "default-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:",
        "media-src data: blob:",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join('; '),
    )
  })
})
