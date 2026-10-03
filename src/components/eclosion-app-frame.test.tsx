import 'fake-indexeddb/auto'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { permissionManager, resetPermissionManager } from '@/core/permissions'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { createEclosionCache } from '@/services/eclosion-cache'
import { EclosionOrchestrator } from '@/services/eclosion'
import { buildThemeTokenCss } from '@/services/eclosion-theme'
import { systemVfs } from '@/services/vfs'

import { EclosionAppFrame, EclosionTitleExtras } from './eclosion-app-frame'

/**
 * jsdom 不真加载 iframe（about:blank 窗口可直接作为 event.source 模拟 runner，
 * web-app-frame.test 同款）；编排器注入假传输 + fake-indexeddb。
 */

const CALCULATOR = 'com.ageha.eclosion.calculator'
const NOTES = 'com.ageha.eclosion.notes'

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function eventFrom(source: Window | null, data: unknown) {
  return new MessageEvent('message', { data, source })
}

const DOC_HTML =
  '<!doctype html><html><head><style>.x{color:red}</style></head><body><div id="numpad">1</div><script>calc()</script></body></html>'

interface Posted {
  type: string
  reqId?: string
  ok?: boolean
  error?: string
  seq?: number
  html?: string
  scripts?: string[]
  capabilities?: { apis: string[] }
}

function makeOrchestrator(responses: Array<Response>) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith('/quota')) {
      return new Response(JSON.stringify({ configured: true, quotas: { basic: { used: 0, limit: 10 } } }), {
        status: 200,
      })
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(url), body })
    const next = responses.shift()
    if (next === undefined) {
      return new Response(JSON.stringify({ error: 'ai-not-configured' }), { status: 503 })
    }
    return next
  })
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const orchestrator = new EclosionOrchestrator({ fetcher, cache: createEclosionCache() })
  return { orchestrator, calls }
}

/** 渲染并驱动到 runner 握手完成；返回消息捕获器。 */
async function renderHosted(options: {
  orchestrator: EclosionOrchestrator
  appId?: string
  windowId?: string
}) {
  const appId = options.appId ?? CALCULATOR
  const windowId =
    options.windowId ?? useWindowStore.getState().open({ appId, title: '计算器' })
  render(
    <EclosionAppFrame
      appId={appId}
      windowId={windowId}
      title="计算器"
      orchestrator={options.orchestrator}
    />,
  )
  const session = options.orchestrator.ensureSession(appId)
  await act(async () => {
    await session?.settled()
  })

  const iframe = document.querySelector('iframe') as HTMLIFrameElement
  const runner = iframe.contentWindow as Window
  const posted: Posted[] = []
  runner.postMessage = vi.fn(((message: Posted) => {
    posted.push(message)
  }) as never)

  return { windowId, iframe, runner, posted, session }
}

// fake-indexeddb 同文件共享库：每用例独立 userId（同库不同区互不可见）。
let userSeq = 0
let frameUser = ''

beforeEach(() => {
  userSeq += 1
  frameUser = `u-frame-${userSeq}`
  localStorage.clear()
  resetEclosionStore()
  seedEclosionForTests(frameUser, true)
  resetPermissionManager()
  resetWindowStore()
  resetNotificationStore()
  systemBus.clear()
})

afterEach(() => {
  vi.useRealTimers()
  systemBus.clear()
  useSessionStore.setState({ user: null })
})

describe('EclosionAppFrame（宿主容器）', () => {
  it('renders the sandboxed runner iframe with a cache-busting version param', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(frameUser, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 2,
      html: DOC_HTML,
      createdAt: '',
    })
    const fetcher = vi.fn()
    const orchestrator = new EclosionOrchestrator({ fetcher, cache })
    const { iframe } = await renderHosted({ orchestrator })

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('src')).toMatch(/^\/apps\/runtime\/eclosion\.html\?v=.+$/)
    expect(fetcher).not.toHaveBeenCalled() // 缓存命中零网络
  })

  it('falls back to the native calculator while the mode is off (§2.1)', async () => {
    seedEclosionForTests(frameUser, false)
    const { orchestrator } = makeOrchestrator([])
    const windowId = useWindowStore.getState().open({ appId: CALCULATOR, title: '计算器' })
    render(
      <EclosionAppFrame appId={CALCULATOR} windowId={windowId} title="计算器" orchestrator={orchestrator} />,
    )

    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByTestId('calculator-display')).toBeInTheDocument()
  })

  it('falls back to the native notes app for notes when the mode is off', async () => {
    seedEclosionForTests(frameUser, false)
    const { orchestrator } = makeOrchestrator([])
    const windowId = useWindowStore.getState().open({ appId: NOTES, title: '记事' })
    render(<EclosionAppFrame appId={NOTES} windowId={windowId} title="记事" orchestrator={orchestrator} />)

    expect(screen.getByText('选择或新建一条笔记')).toBeInTheDocument()
  })

  it('streams theme + chunks + power-on over the whitelist protocol, then clears progress on rendered', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(frameUser, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 2,
      html: DOC_HTML,
      createdAt: '',
    })
    const orchestrator = new EclosionOrchestrator({ fetcher: vi.fn(), cache })
    const { iframe, runner, posted } = await renderHosted({ orchestrator })

    expect(screen.getByTestId('eclosion-progress')).toBeInTheDocument()

    // 握手：load → hello；ready → 开始下发。
    fireEvent.load(iframe)
    expect(posted[0]).toEqual({ type: 'agehaos:hello' })

    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })

    await waitFor(() => {
      expect(posted.some((message) => message.type === 'eclosion:power-on')).toBe(true)
    })

    // 主题 Token 先行（seq 0，--ageha-* 子集），分片随后且不含 script。
    expect(posted[1]).toMatchObject({ type: 'eclosion:chunk', seq: 0 })
    expect(String(posted[1]?.html)).toContain('--ageha-primary')
    const chunkHtml = posted
      .filter((message) => message.type === 'eclosion:chunk')
      .map((message) => message.html)
      .join('')
    expect(chunkHtml).toContain('.x{color:red}')
    expect(chunkHtml).toContain('<div id="numpad">1</div>')
    expect(chunkHtml).not.toContain('calc()')
    // 破茧：脚本收尾注入，且随信声明按规格推导的 SDK 能力（计算器恒仅 theme）。
    expect(posted.find((message) => message.type === 'eclosion:power-on')).toMatchObject({
      scripts: ['calc()'],
      capabilities: { apis: ['theme'] },
    })

    // rendered → 进度条消失 + eclosion.app.ready。
    const ready = vi.fn()
    systemBus.on('eclosion.app.ready', ready)
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'eclosion:rendered' }))
    })
    await waitFor(() => expect(screen.queryByTestId('eclosion-progress')).toBeNull())
    expect(ready).toHaveBeenCalledWith({ appId: CALCULATOR, specId: 'calculator', source: 'cache' })
  })

  it('drops messages that do not come from its own contentWindow', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic(frameUser, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 2,
      html: DOC_HTML,
      createdAt: '',
    })
    const orchestrator = new EclosionOrchestrator({ fetcher: vi.fn(), cache })
    const { iframe, runner, posted } = await renderHosted({ orchestrator })

    fireEvent.load(iframe)
    // 外部窗口伪造 ready：丢弃。
    act(() => {
      window.dispatchEvent(eventFrom(window, { type: 'agehaos:ready' }))
      window.dispatchEvent(eventFrom(runner, { type: 'eclosion:rendered' })) // 未 ready 先 rendered：也无害
    })
    expect(posted.filter((message) => message.type === 'eclosion:chunk')).toHaveLength(0)

    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })
    await waitFor(() =>
      expect(posted.filter((message) => message.type === 'eclosion:chunk').length).toBeGreaterThan(0),
    )
  })

  it('SDK 路由权限恒来自规格表：notes 的 files 放行且钳制在本应用目录、规格外一律拒绝', async () => {
    // notes 规格 = ['filesystem.read','filesystem.write']：files 放行；storage 拒绝。
    const cache = createEclosionCache()
    await cache.writeBasic(frameUser, {
      appId: NOTES,
      specId: 'notes',
      specVersion: 2,
      html: DOC_HTML,
      createdAt: '',
    })
    const orchestrator = new EclosionOrchestrator({ fetcher: vi.fn(), cache })
    const { iframe, runner, posted } = await renderHosted({ orchestrator, appId: NOTES })
    fireEvent.load(iframe)
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })
    await waitFor(() => expect(posted.some((message) => message.type === 'eclosion:power-on')).toBe(true))
    // power-on 能力声明按 notes 规格推导（theme + files）。
    expect(posted.find((message) => message.type === 'eclosion:power-on')).toMatchObject({
      capabilities: { apis: ['theme', 'files'] },
    })

    const fileName = `note-${userSeq}.txt`
    act(() => {
      window.dispatchEvent(
        eventFrom(runner, {
          type: 'agehaos:sdk',
          reqId: 'r1',
          api: 'files',
          action: 'write',
          params: { path: fileName, content: 'hello-notes' },
        }),
      )
    })
    await waitFor(() => {
      const result = posted.find((m) => m.type === 'agehaos:sdk-result' && m.reqId === 'r1')
      expect(result).toMatchObject({ reqId: 'r1', ok: true })
    })
    // 命名空间隔离（ADR 16 目录钳制）：落盘位置恰为 /Apps/<appId>/。
    await systemVfs.ready()
    expect(await systemVfs.readFile(`/Apps/${NOTES}/${fileName}`)).toBe('hello-notes')

    // 规格外能力（notes 无 storage）：拒绝并审计 permission.denied。
    const deniedEvent = vi.fn()
    systemBus.on('permission.denied', deniedEvent)
    act(() => {
      window.dispatchEvent(
        eventFrom(runner, {
          type: 'agehaos:sdk',
          reqId: 'r2',
          api: 'storage',
          action: 'set',
          params: { key: 'k', value: 1 },
        }),
      )
    })
    await waitFor(() => {
      const result = posted.find((m) => m.type === 'agehaos:sdk-result' && m.reqId === 'r2')
      expect(result).toMatchObject({ reqId: 'r2', ok: false, error: 'permission-denied' })
    })
    expect(deniedEvent).toHaveBeenCalledWith({ appId: NOTES, permission: 'storage' })
  })

  it('SDK 路由权限恒来自规格表：计算器即便被 permissionManager 授予 storage 也拒绝（L1/空权限差异）', async () => {
    // 规格表是唯一权限来源：运行时授予不得放宽（L2/L3 恒空权限走同一分支——
    // spec 查无 → NO_SDK_PERMISSIONS，SDK 一律拒绝）。
    const { orchestrator } = makeOrchestrator([
      new Response(frame('delta', { text: DOC_HTML }) + frame('done', {}), {
        headers: { 'content-type': 'text/event-stream' },
      }),
    ])
    const { iframe, runner, posted } = await renderHosted({ orchestrator })
    fireEvent.load(iframe)
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })
    await waitFor(() => expect(posted.some((message) => message.type === 'eclosion:power-on')).toBe(true))

    localStorage.clear()
    permissionManager.grant(CALCULATOR, 'storage') // 越规格授予：不生效
    act(() => {
      window.dispatchEvent(
        eventFrom(runner, {
          type: 'agehaos:sdk',
          reqId: 'r1',
          api: 'storage',
          action: 'set',
          params: { key: 'k', value: 1 },
        }),
      )
    })
    await waitFor(() => expect(posted.some((m) => m.type === 'agehaos:sdk-result')).toBe(true))
    expect(posted.find((m) => m.type === 'agehaos:sdk-result')).toMatchObject({
      reqId: 'r1',
      ok: false,
      error: 'permission-denied',
    })
    expect(localStorage.getItem('agehaos.sdk.storage.com.ageha.eclosion.calculator')).toBeNull()

    // theme 免许可只读面照常可用（能力声明里恒有）。
    act(() => {
      window.dispatchEvent(
        eventFrom(runner, { type: 'agehaos:sdk', reqId: 'r2', api: 'theme', action: 'get', params: {} }),
      )
    })
    await waitFor(() => {
      expect(posted.find((m) => m.type === 'agehaos:sdk-result' && m.reqId === 'r2')).toMatchObject({
        reqId: 'r2',
        ok: true,
      })
    })
  })

  it('SDK 请求按声明能力面求交集：绕过特性检测直呼 user/permissions/system 一律拒绝', async () => {
    // 攻击面：生成代码与 runner 同帧，可不经过 window.AgehaOS 特性检测直接
    // postMessage。宿主即便已登录（getUser 有值），未声明命名空间也不得经
    // sdk-bridge 免许可面回数据（§4.1 第 4 条：零权限面只有 theme 只读）。
    useSessionStore.setState({
      user: {
        id: 'u-sec-1',
        username: 'alice',
        displayName: 'Alice',
        createdAt: '2026-10-03T00:00:00.000Z',
        updatedAt: '2026-10-03T00:00:00.000Z',
      },
    })
    const cache = createEclosionCache()
    await cache.writeBasic(frameUser, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 2,
      html: DOC_HTML,
      createdAt: '',
    })
    const orchestrator = new EclosionOrchestrator({ fetcher: vi.fn(), cache })
    const { iframe, runner, posted } = await renderHosted({ orchestrator })
    fireEvent.load(iframe)
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })
    await waitFor(() => expect(posted.some((message) => message.type === 'eclosion:power-on')).toBe(true))
    // 能力声明恒仅 theme（计算器零权限）：直呼免许可面（user/permissions/system，
    // 不在羽化能力面）必须被宿主拒绝，而不是直通数据。
    const probes: Array<{ reqId: string; api: string; action: string }> = [
      { reqId: 'r-user', api: 'user', action: 'get' },
      { reqId: 'r-perms', api: 'permissions', action: 'all' },
      { reqId: 'r-sys', api: 'system', action: 'info' },
    ]
    act(() => {
      for (const probe of probes) {
        window.dispatchEvent(eventFrom(runner, { type: 'agehaos:sdk', ...probe, params: {} }))
      }
    })
    await waitFor(() => {
      for (const probe of probes) {
        expect(
          posted.find((m) => m.type === 'agehaos:sdk-result' && m.reqId === probe.reqId),
        ).toMatchObject({ reqId: probe.reqId, ok: false, error: 'permission-denied' })
      }
    })
    // 拒绝回执里绝无登录用户身份。
    for (const probe of probes) {
      expect(
        JSON.stringify(posted.find((m) => m.type === 'agehaos:sdk-result' && m.reqId === probe.reqId)),
      ).not.toContain('alice')
    }
    // 已声明面照常：theme 免许可只读不受影响。
    act(() => {
      window.dispatchEvent(
        eventFrom(runner, { type: 'agehaos:sdk', reqId: 'r-theme', api: 'theme', action: 'get', params: {} }),
      )
    })
    await waitFor(() => {
      expect(posted.find((m) => m.type === 'agehaos:sdk-result' && m.reqId === 'r-theme')).toMatchObject({
        reqId: 'r-theme',
        ok: true,
      })
    })
  })

  it('retries once on a runner error, then falls back with the classic-version title notice', async () => {
    const okDoc = () =>
      new Response(frame('delta', { text: DOC_HTML }) + frame('done', {}), {
        headers: { 'content-type': 'text/event-stream' },
      })
    const { orchestrator, calls } = makeOrchestrator([okDoc(), okDoc()])
    const { runner, posted, windowId } = await renderHosted({ orchestrator })
    fireEvent.load(document.querySelector('iframe') as HTMLIFrameElement)
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })
    await waitFor(() => expect(posted.some((message) => message.type === 'eclosion:power-on')).toBe(true))

    // 第一次运行失败 → 自动重试（新一轮尝试，iframe 重挂）。
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'eclosion:error', message: 'boom' }))
    })
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const retrySession = orchestrator.ensureSession(CALCULATOR)
    await act(async () => {
      await retrySession?.settled()
    })
    expect(retrySession?.getSnapshot().attempt).toBe(2)
    expect(calls[1]?.body).toMatchObject({ regenerate: true })

    // 第二次也失败 → 回落原生 + 标题提示 + eclosion.app.failed。
    const failed = vi.fn()
    systemBus.on('eclosion.app.failed', failed)
    // 重挂的 iframe 需要重新驱动握手（jsdom 不真加载 runner）。
    const secondIframe = document.querySelector('iframe') as HTMLIFrameElement
    const secondRunner = secondIframe.contentWindow as Window
    const secondPosted: Posted[] = []
    secondRunner.postMessage = vi.fn(((message: Posted) => {
      secondPosted.push(message)
    }) as never)
    fireEvent.load(secondIframe)
    act(() => {
      window.dispatchEvent(eventFrom(secondRunner, { type: 'agehaos:ready' }))
    })
    await waitFor(() => {
      expect(secondPosted.some((message) => message.type === 'eclosion:power-on')).toBe(true)
    })
    act(() => {
      window.dispatchEvent(eventFrom(secondRunner, { type: 'eclosion:error', message: 'boom again' }))
    })

    await waitFor(() => expect(screen.getByTestId('calculator-display')).toBeInTheDocument())
    expect(document.querySelector('iframe')).toBeNull()
    expect(
      useWindowStore.getState().windows.find((win) => win.id === windowId)?.title,
    ).toBe('计算器 · 已回落经典版')
    expect(failed).toHaveBeenCalledWith({
      appId: CALCULATOR,
      specId: 'calculator',
      reason: expect.stringContaining('runner-error'),
    })
  })

  it('treats a missing rendered after power-on as a failure after 5 seconds (fake timers)', async () => {
    // 坑 10：fake timers 下 waitFor 死锁——断言直查；且只 fake setTimeout
    // （fake-indexeddb 依赖 setImmediate，一并 fake 会让缓存读取永久挂起）。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const okDoc = () =>
      new Response(frame('delta', { text: DOC_HTML }) + frame('done', {}), {
        headers: { 'content-type': 'text/event-stream' },
      })
    const { orchestrator } = makeOrchestrator([okDoc()])
    const { iframe, runner, posted } = await renderHosted({ orchestrator })
    fireEvent.load(iframe)
    act(() => {
      window.dispatchEvent(eventFrom(runner, { type: 'agehaos:ready' }))
    })
    // act 内效果同步跑完：power-on 已随握手下发。
    expect(posted.some((message) => message.type === 'eclosion:power-on')).toBe(true)

    // 5 秒无 rendered → 走同一重试决策。
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    const session = orchestrator.ensureSession(CALCULATOR)
    await act(async () => {
      await session?.settled()
    })
    expect(session?.getSnapshot().attempt).toBe(2)
  })

  it('falls back immediately on ai-not-configured without burning a retry', async () => {
    const { orchestrator, calls } = makeOrchestrator([
      new Response(JSON.stringify({ error: 'ai-not-configured' }), { status: 503 }),
    ])
    const windowId = useWindowStore.getState().open({ appId: CALCULATOR, title: '计算器' })
    render(
      <EclosionAppFrame appId={CALCULATOR} windowId={windowId} title="计算器" orchestrator={orchestrator} />,
    )

    await waitFor(() => expect(screen.getByTestId('calculator-display')).toBeInTheDocument())
    expect(calls).toHaveLength(1)
    expect(document.querySelector('iframe')).toBeNull()
    expect(
      useWindowStore.getState().windows.find((win) => win.id === windowId)?.title,
    ).toBe('计算器 · 已回落经典版')
  })

  it('shows the cocooning progress with thinking chars while streaming', async () => {
    let releaseStream!: (value: string) => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(frame('think', { chars: 88 }) + frame('delta', { text: '<!doctype html><html><body><div>1</div>' })))
        releaseStream = (text: string) => {
          controller.enqueue(encoder.encode(text))
          controller.close()
        }
      },
    })
    const orchestrator = new EclosionOrchestrator({
      fetcher: vi.fn(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } })),
      cache: createEclosionCache(),
    })
    render(
      <EclosionAppFrame
        appId={CALCULATOR}
        windowId="w-stream"
        title="计算器"
        orchestrator={orchestrator}
      />,
    )

    await waitFor(() =>
      expect(screen.getByTestId('eclosion-progress').textContent).toContain('88'),
    )
    expect(screen.getByTestId('eclosion-progress').textContent).toContain('结茧中')

    act(() => {
      releaseStream(frame('done', {}))
    })
    const session = orchestrator.ensureSession(CALCULATOR)
    await act(async () => {
      await session?.settled()
    })
  })
})

describe('EclosionTitleExtras（标题栏重新羽化/密码警示）', () => {
  it('shows the regenerate action; the AI badge was removed by the 2026-10-03 ruling', () => {
    const onRegenerate = vi.fn()
    render(<EclosionTitleExtras appId={CALCULATOR} windowId="w-extras" onRegenerate={onRegenerate} />)

    expect(screen.queryByTestId('eclosion-ai-badge')).toBeNull()
    fireEvent.click(screen.getByTestId('eclosion-regenerate'))
    expect(onRegenerate).toHaveBeenCalledWith(CALCULATOR)
    expect(screen.queryByTestId('eclosion-password-warning')).toBeNull()
  })

  it('raises the red password warning when the generated content contains a password input', () => {
    useEclosionStore.getState().setStatus(CALCULATOR, { passwordInputSeen: true })
    render(<EclosionTitleExtras appId={CALCULATOR} windowId="w-extras" onRegenerate={vi.fn()} />)

    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('请勿输入真实密码')
  })
})

describe('buildThemeTokenCss（--ag-* → --ageha-* 映射下发）', () => {
  it('emits the light subset by default and the dark subset under .dark', () => {
    document.documentElement.classList.remove('dark')
    const light = buildThemeTokenCss()
    expect(light).toContain('--ageha-bg:#eef4fd')
    expect(light).toContain('--ageha-primary:#2f5fe8')
    expect(light).toContain('--ageha-radius:12px')

    document.documentElement.classList.add('dark')
    const dark = buildThemeTokenCss()
    expect(dark).toContain('--ageha-bg:#0c1220')
    expect(dark).toContain('--ageha-primary:#82a3ff')
    document.documentElement.classList.remove('dark')
  })

  it('prefers computed token values when the stylesheet resolves them', () => {
    document.documentElement.style.setProperty('--ag-primary', '#123456')
    try {
      const css = buildThemeTokenCss()
      // jsdom 不解析 :root 样式表（计算值为空）时回落字面量；注入的内联值若可解析则优先。
      expect(css).toMatch(/--ageha-primary:(#123456|#2f5fe8)/)
    } finally {
      document.documentElement.style.removeProperty('--ag-primary')
    }
  })
})

describe('EclosionAppFrame × 今日应用（§6.4：错误卡不落原生 / 获取）', () => {
  const TODAY_APP = 'com.ageha.eclosion.app-01'

  function seedTodayWorld(): void {
    useEclosionStore.getState().applyWorld({
      worldDate: new Date().toISOString().slice(0, 10),
      headline: '本地智能体与边缘推理的清晨',
      paletteId: 'nebula-violet',
      accentHue: 212,
      degraded: false,
      signalCount: 1,
      signals: { titles: ['信号甲'], sourceName: 'GitHub Trending', sourceUrl: '' },
      apps: [
        { slug: 'app-01', name: '应用零一', hue: 268, tagline: '一句话', category: 'tools', window: { width: 720, height: 480 } },
      ],
    })
  }

  it('renders the L2 error card on terminal failure — never the native fallback', async () => {
    seedTodayWorld()
    const { orchestrator, calls } = makeOrchestrator([
      new Response(JSON.stringify({ error: 'ai-not-configured' }), { status: 503 }),
    ])
    const windowId = useWindowStore.getState().open({ appId: TODAY_APP, title: '应用零一' })
    render(
      <EclosionAppFrame appId={TODAY_APP} windowId={windowId} title="应用零一" orchestrator={orchestrator} />,
    )

    await waitFor(() => expect(screen.getByTestId('eclosion-error-card')).toBeInTheDocument())
    // L2 没有原生真身：绝不渲染原生计算器/记事本，也不换「已回落经典版」标题。
    expect(screen.queryByTestId('calculator-display')).toBeNull()
    expect(
      useWindowStore.getState().windows.find((win) => win.id === windowId)?.title,
    ).toBe('应用零一')
    // 未配置 AI 不重试；重试按钮在（用户显式动作仍可走重新羽化）。
    expect(calls).toHaveLength(1)
    expect(screen.getByTestId('eclosion-error-retry')).toBeInTheDocument()
  })

  it('renders the disabled error card while eclosion is off (L2 无原生兜底)', () => {
    seedTodayWorld()
    seedEclosionForTests(frameUser, false)
    const { orchestrator } = makeOrchestrator([])
    const windowId = useWindowStore.getState().open({ appId: TODAY_APP, title: '应用零一' })
    render(
      <EclosionAppFrame appId={TODAY_APP} windowId={windowId} title="应用零一" orchestrator={orchestrator} />,
    )

    expect(screen.getByTestId('eclosion-error-card')).toBeInTheDocument()
    expect(screen.getByTestId('eclosion-error-card').textContent).toContain('羽化模式已关闭')
    expect(screen.queryByTestId('eclosion-error-retry')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('streams a kept snapshot instantly without touching the network (跨重启秒开)', async () => {
    const cache = createEclosionCache()
    await cache.writeKept(frameUser, {
      appId: 'com.ageha.eclosion.gone-kept',
      name: '留存应用',
      html: DOC_HTML,
      createdAt: '',
    })
    const fetcher = vi.fn()
    const orchestrator = new EclosionOrchestrator({ fetcher, cache })
    const windowId = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.eclosion.gone-kept', title: '留存应用' })
    render(
      <EclosionAppFrame
        appId="com.ageha.eclosion.gone-kept"
        windowId={windowId}
        title="留存应用"
        orchestrator={orchestrator}
      />,
    )
    const session = orchestrator.ensureSession('com.ageha.eclosion.gone-kept')
    await act(async () => {
      await session?.settled()
    })

    expect(session?.getSnapshot()).toMatchObject({ phase: 'done', source: 'cache' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('EclosionTitleExtras × 获取（§6.4/§8）', () => {
  const TODAY_APP = 'com.ageha.eclosion.app-01'

  it('offers Keep only for the today/kept domain, and flips to Kept on success', async () => {
    // L1 三件套不出现「获取」。
    const { rerender } = render(<EclosionTitleExtras appId={CALCULATOR} windowId="w-extras" onRegenerate={vi.fn()} />)
    expect(screen.queryByTestId('eclosion-keep')).toBeNull()

    const onKeep = vi.fn(async () => true)
    rerender(<EclosionTitleExtras appId={TODAY_APP} windowId="w-extras" onRegenerate={vi.fn()} onKeep={onKeep} />)
    fireEvent.click(screen.getByTestId('eclosion-keep'))
    expect(onKeep).toHaveBeenCalledWith(TODAY_APP)
    await waitFor(() =>
      expect(screen.getByTestId('eclosion-keep').textContent).toContain('已获取'),
    )
    expect(screen.getByTestId('eclosion-keep')).toBeDisabled()
  })

  it('stays actionable when the keep source is missing (点击无果保持原样)', async () => {
    const onKeep = vi.fn(async () => false)
    render(<EclosionTitleExtras appId={TODAY_APP} windowId="w-extras" onRegenerate={vi.fn()} onKeep={onKeep} />)
    fireEvent.click(screen.getByTestId('eclosion-keep'))
    await waitFor(() => expect(onKeep).toHaveBeenCalled())
    expect(screen.getByTestId('eclosion-keep').textContent).toContain('获取')
    expect(screen.getByTestId('eclosion-keep')).toBeEnabled()
  })

  it('renders the Kept state when the app is already in the kept list', () => {
    useEclosionStore.getState().setKeptAppIds([TODAY_APP])
    render(<EclosionTitleExtras appId={TODAY_APP} windowId="w-extras" onRegenerate={vi.fn()} onKeep={vi.fn()} />)

    expect(screen.getByTestId('eclosion-keep').textContent).toContain('已获取')
    expect(screen.getByTestId('eclosion-keep')).toBeDisabled()
  })
})

// ── 想象域（§7，P3）：L3 标题栏「获取」+ 额度耗尽错误卡 ──────────────────────

import { imagineAppIdForQuery } from '@/core/eclosion/spec'

describe('EclosionTitleExtras/EclosionAppFrame × 想象域（§7）', () => {
  const IMAGINE_APP = imagineAppIdForQuery('番茄钟')

  it('offers Keep for imagine apps too (L3 快照源 = 会话内存)', async () => {
    const onKeep = vi.fn(async () => true)
    render(<EclosionTitleExtras appId={IMAGINE_APP} windowId="w-extras" onRegenerate={vi.fn()} onKeep={onKeep} />)
    fireEvent.click(screen.getByTestId('eclosion-keep'))
    expect(onKeep).toHaveBeenCalledWith(IMAGINE_APP)
    await waitFor(() =>
      expect(screen.getByTestId('eclosion-keep').textContent).toContain('已获取'),
    )
  })

  it('renders the quota-exhausted error card with the imagine tier and reset time (§12 P3 提示清晰)', async () => {
    const { orchestrator, calls } = makeOrchestrator([
      new Response(JSON.stringify({ error: 'quota-exceeded' }), { status: 429 }),
    ])
    // 额度快照：imagine 档 20/20 + 重置时刻（错误卡展示来源）。
    useEclosionStore.getState().applyQuota({
      configured: true,
      basic: { used: 0, limit: 10 },
      today: { used: 3, limit: 30 },
      imagine: { used: 20, limit: 20 },
      resetAtIso: '2026-10-03T16:00:00.000Z',
    })
    orchestrator.ensureImagineSession('番茄钟')
    const windowId = useWindowStore.getState().open({ appId: IMAGINE_APP, title: '番茄钟' })
    render(
      <EclosionAppFrame appId={IMAGINE_APP} windowId={windowId} title="番茄钟" orchestrator={orchestrator} />,
    )

    await waitFor(() => expect(screen.getByTestId('eclosion-error-card')).toBeInTheDocument())
    // 提示清晰：imagine 档（20/20），而非 today/basic 档；带重置时刻。
    const card = screen.getByTestId('eclosion-error-card')
    expect(card.textContent).toContain('20/20')
    expect(card.textContent).toContain('重置')
    expect(card.textContent).not.toContain('30')
    // 429 是确定性失败：不自动重试（一次请求即终态）。
    expect(calls).toHaveLength(1)
  })
})


// ── 举报与会话封禁（§10，P4 治理） ──────────────────────────────────────────

describe('EclosionTitleExtras × 举报（§10 同意框）', () => {
  it('opens the confirm dialog, cancels without reporting', () => {
    const onReport = vi.fn(async () => true)
    render(
      <EclosionTitleExtras appId={CALCULATOR} windowId="w-report" onRegenerate={vi.fn()} onReport={onReport} />,
    )

    fireEvent.click(screen.getByTestId('eclosion-report'))
    // 同意框 portal 至 body（坑 67）：fixed 定位不吃窗口拖拽 transform。
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('举报')
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onReport).not.toHaveBeenCalled()
  })

  it('confirms and closes the dialog only on a successful upload', async () => {
    const onReport = vi.fn(async () => true)
    render(
      <EclosionTitleExtras appId={CALCULATOR} windowId="w-report" onRegenerate={vi.fn()} onReport={onReport} />,
    )
    fireEvent.click(screen.getByTestId('eclosion-report'))
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

    await waitFor(() => expect(onReport).toHaveBeenCalledWith(CALCULATOR, 'w-report'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the dialog with an inline error when the upload fails (可重试)', async () => {
    const onReport = vi.fn(async () => false)
    render(
      <EclosionTitleExtras appId={CALCULATOR} windowId="w-report" onRegenerate={vi.fn()} onReport={onReport} />,
    )
    fireEvent.click(screen.getByTestId('eclosion-report'))
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('失败'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('EclosionAppFrame × 会话封禁（§10 举报后不可再打开）', () => {
  it('renders the banned card without retry, iframe, or any further request', async () => {
    // 走真实举报链路：编排器 Set 是门禁事实源，store 镜像驱动宿主渲染。
    const cache = createEclosionCache()
    await cache.writeBasic(frameUser, {
      appId: CALCULATOR,
      specId: 'calculator',
      specVersion: 2,
      html: DOC_HTML,
      createdAt: '',
    })
    const { orchestrator } = makeOrchestrator([
      new Response(JSON.stringify({ status: 'accepted', id: 's-1', classification: 'ok' }), {
        status: 201,
      }),
    ])
    const reportedWindowId = useWindowStore
      .getState()
      .open({ appId: CALCULATOR, title: '计算器' })
    await expect(orchestrator.reportApp(CALCULATOR, reportedWindowId)).resolves.toBe(true)
    expect(useWindowStore.getState().windows.some((win) => win.id === reportedWindowId)).toBe(false)

    // 举报后再开窗：封禁卡（无重试入口、不建沙箱、零生成请求）。
    const windowId = useWindowStore.getState().open({ appId: CALCULATOR, title: '计算器' })
    render(
      <EclosionAppFrame appId={CALCULATOR} windowId={windowId} title="计算器" orchestrator={orchestrator} />,
    )

    const card = screen.getByTestId('eclosion-banned-card')
    expect(card.textContent).toContain('已举报')
    expect(screen.queryByTestId('eclosion-error-retry')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    // 编排器侧同样拒绝再开会话（纵深防御）。
    expect(orchestrator.ensureSession(CALCULATOR)).toBeNull()
  })
})
