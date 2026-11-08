import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyUrlFor, searchUrlFor } from './browser-nav'
import { resetBrowserStore, useBrowserStore } from './browser-store'
import { BrowserApp } from './BrowserApp'

/**
 * 浏览器应用（档 C）：地址栏（域名直访 / 关键词搜索）、标签页、后退/前进
 * （iframe 保活组）、刷新（仅重挂当前条目）、星标收藏、新标签打开、起始页
 * 书签与最近访问。iframe 的 src = 代理地址是全链路契约的客户端半场（服务端
 * 半场在 server/test/browse.test.ts）。
 */

beforeEach(() => {
  resetBrowserStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function addressInput(): HTMLInputElement {
  return screen.getByTestId('browser-address') as HTMLInputElement
}

/** 当前可见（活动）的 iframe；保活组里其余条目 display:none。 */
function activeFrame(): HTMLIFrameElement {
  const frame = screen
    .getAllByTestId('browser-iframe')
    .find((candidate) => candidate.hasAttribute('data-active'))
  if (frame === undefined) throw new Error('no active browser-iframe')
  return frame as HTMLIFrameElement
}

function frameFor(url: string): HTMLIFrameElement | undefined {
  return screen
    .getAllByTestId('browser-iframe')
    .find((candidate) => candidate.getAttribute('data-url') === url) as
    HTMLIFrameElement | undefined
}

function navigate(value: string): void {
  fireEvent.change(addressInput(), { target: { value } })
  fireEvent.keyDown(addressInput(), { key: 'Enter' })
}

/** 引导页回执：必须携带本帧 contentWindow 与子域 origin（D1 来源校验）。 */
function dispatchBrowseReady(ok: boolean, origin = 'http://browse.local'): void {
  const boot = screen.getByTestId('browser-boot')
  const source = { postMessage: vi.fn() } as unknown as Window
  Object.defineProperty(boot, 'contentWindow', { configurable: true, value: source })
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'agehaos:browse-ready', ok },
        origin,
        source,
      }),
    )
  })
}

/** 内容 iframe 的消息源：把 contentWindow 换成可控 Window 以便断言。 */
function registerFrameSource(frame: HTMLIFrameElement, ack = vi.fn()): Window {
  const source = { postMessage: ack } as unknown as Window
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: source })
  return source
}

describe('BrowserApp（档 C：窗口内浏览 + 真实浏览兜底）', () => {
  it('起始页：工具栏与书签/最近访问空态', () => {
    render(<BrowserApp />)

    expect(screen.getByTestId('browser-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('browser-home')).toBeInTheDocument()
    expect(screen.getByText('暂无书签：访问页面后点星标收藏。')).toBeInTheDocument()
    expect(screen.queryByTestId('browser-iframe')).toBeNull()
  })

  it('地址栏域名直访 → iframe 指向代理地址；关键词 → 搜索引擎（经代理）', () => {
    render(<BrowserApp />)

    navigate('example.com/a')
    expect(activeFrame().getAttribute('src')).toBe(proxyUrlFor('https://example.com/a'))

    navigate('北京 天气')
    expect(activeFrame().getAttribute('src')).toBe(proxyUrlFor(searchUrlFor('北京 天气')))
  })

  it('聚焦地址栏即全选（浏览器惯例：直接打字 = 替换旧地址）', () => {
    render(<BrowserApp />)
    navigate('example.com')
    const input = addressInput()
    expect(input.value).toBe('example.com')

    fireEvent.focus(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('example.com'.length)
  })

  it('聚焦全选的 mouseup 防护：首次 mouseup 被 preventDefault 保住选区，二次正常落点', () => {
    render(<BrowserApp />)
    navigate('example.com')
    const input = addressInput()

    fireEvent.focus(input)
    // 首次 mouseup：preventDefault（返回 false）且选区被重新全选。
    expect(fireEvent.mouseUp(input)).toBe(false)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('example.com'.length)
    // 标记已消费：再点一次不拦截（正常落光标改局部）。
    expect(fireEvent.mouseUp(input)).toBe(true)
  })

  it('输入法组合期 Enter 不导航（ime-guard 双重互锁）', () => {
    render(<BrowserApp />)
    const input = addressInput()
    fireEvent.change(input, { target: { value: '北京' } })

    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(composingEnter, 'isComposing', { value: true })
    fireEvent(input, composingEnter)

    expect(screen.queryByTestId('browser-iframe')).toBeNull()
  })

  it('后退/前进秒开（iframe 保活，零重挂）；刷新仅重挂当前条目；新导航卸载前向', () => {
    render(<BrowserApp />)
    navigate('a.example')
    navigate('b.example')
    navigate('c.example')

    const frameA = frameFor('https://a.example')!
    const frameB = frameFor('https://b.example')!
    const frameC = frameFor('https://c.example')!
    expect(activeFrame()).toBe(frameC)

    // 后退两步：活动帧就地切换为既有元素（保活=同一 DOM 节点，无重挂）。
    fireEvent.click(screen.getByTestId('browser-back'))
    expect(activeFrame()).toBe(frameB)
    fireEvent.click(screen.getByTestId('browser-back'))
    expect(activeFrame()).toBe(frameA)
    expect(document.body.contains(frameB)).toBe(true)
    expect(document.body.contains(frameC)).toBe(true)

    // 前进：同样复用既有节点。
    fireEvent.click(screen.getByTestId('browser-forward'))
    expect(activeFrame()).toBe(frameB)

    // 刷新：只重挂当前条目（元素替换 = key 变化），其余保活节点不动。
    fireEvent.click(screen.getByTestId('browser-reload'))
    const reloadedB = activeFrame()
    expect(reloadedB).not.toBe(frameB)
    expect(reloadedB.getAttribute('src')).toBe(proxyUrlFor('https://b.example'))
    expect(document.body.contains(frameA)).toBe(true)

    // 从 B 处新导航：前向条目（C）被截断卸载。
    navigate('d.example')
    expect(frameFor('https://c.example')).toBeUndefined()
    expect(frameFor('https://d.example')).toBeDefined()
    expect(document.body.contains(frameA)).toBe(true)
  })

  it('保活窗口有界（双向 ±5）：越窗条目卸载、回窗重挂', () => {
    render(<BrowserApp />)
    for (let index = 0; index < 8; index += 1) {
      navigate(`s${index}.example`)
    }
    // 8 次导航后：窗口 = 后方 5 + 当前 = index 7..2（6 个条目），s0/s1 已淘汰。
    expect(screen.getAllByTestId('browser-iframe')).toHaveLength(6)
    expect(frameFor('https://s0.example')).toBeUndefined()
    expect(frameFor('https://s2.example')).toBeDefined()
    expect(frameFor('https://s7.example')).toBeDefined()

    // 一路后退到 s0：前向侧窗口 ±5 → 仅 s0..s5 常驻（s6/s7 越前向窗卸载）。
    for (let index = 0; index < 7; index += 1) {
      fireEvent.click(screen.getByTestId('browser-back'))
    }
    expect(activeFrame().getAttribute('data-url')).toBe('https://s0.example')
    expect(screen.getAllByTestId('browser-iframe')).toHaveLength(6)
    expect(frameFor('https://s6.example')).toBeUndefined()
    expect(frameFor('https://s5.example')).toBeDefined()
  })

  it('星标收藏/取消 + 起始页书签列表可回访', () => {
    render(<BrowserApp />)
    navigate('example.com')

    const star = screen.getByTestId('browser-bookmark')
    expect(star).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(star)
    expect(star).toHaveAttribute('aria-pressed', 'true')
    expect(useBrowserStore.getState().bookmarks).toHaveLength(1)

    // 新标签回到起始页：书签列表可见并可回访。
    fireEvent.click(screen.getByTestId('browser-new-tab'))
    expect(screen.getByTestId('browser-home')).toBeInTheDocument()
    const bookmarkList = screen.getByTestId('browser-bookmark-list')
    fireEvent.click(within(bookmarkList).getByText('example.com'))
    expect(activeFrame().getAttribute('src')).toBe(proxyUrlFor('https://example.com'))

    fireEvent.click(star)
    expect(star).toHaveAttribute('aria-pressed', 'false')
  })

  it('标签页：新建/关闭/关到最后一个回退空白页', () => {
    render(<BrowserApp />)
    expect(screen.getAllByTestId('browser-tab')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('browser-new-tab'))
    expect(screen.getAllByTestId('browser-tab')).toHaveLength(2)

    const closes = screen.getAllByTestId('browser-tab-close')
    fireEvent.click(closes[1] as HTMLElement)
    expect(screen.getAllByTestId('browser-tab')).toHaveLength(1)

    fireEvent.click(screen.getAllByTestId('browser-tab-close')[0] as HTMLElement)
    expect(screen.getAllByTestId('browser-tab')).toHaveLength(1) // 关闭最后一个 → 重建空白页
    expect(screen.getByTestId('browser-home')).toBeInTheDocument()
  })

  it('切标签保活：另一标签的 iframe 常驻（隐藏），切回零重载', () => {
    render(<BrowserApp />)
    navigate('a.example')
    const frameA = frameFor('https://a.example')!

    fireEvent.click(screen.getByTestId('browser-new-tab'))
    expect(screen.getByTestId('browser-home')).toBeInTheDocument()
    expect(document.body.contains(frameA)).toBe(true) // 旧标签页保活

    // 切回第一个标签：同一节点重新可见。
    const firstTab = screen.getAllByTestId('browser-tab')[0]!
    fireEvent.click(within(firstTab).getByRole('button', { name: /a\.example/ }))
    expect(activeFrame()).toBe(frameA)
  })

  it('在新标签页打开：window.open 真实地址（非代理地址）+ noopener', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<BrowserApp />)
    navigate('example.com')

    fireEvent.click(screen.getByTestId('browser-open-external'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('站点数据：起始页展示服务端罐条目数并可清除（不回值）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ count: 2, origins: ['https://a.example', 'https://b.example'] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    render(<BrowserApp />)

    const panel = await screen.findByTestId('browser-site-data')
    expect(within(panel).getByText('已保存 2 条站点登录数据（仅存于服务器）')).toBeInTheDocument()
    // 只回条目数——源与值都不上屏（隐私面最小化）。
    expect(panel.textContent).not.toContain('a.example')

    // 清除是全站登录态：先二次确认（D1 审查）。
    fireEvent.click(screen.getByTestId('browser-site-data-clear'))
    expect(screen.getByRole('dialog', { name: '清除站点数据' })).toBeInTheDocument()

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ cleared: true }), { status: 200 }))
    // 成功后重拉摘要（服务端唯一事实源）。
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ count: 0, origins: [] }), { status: 200 }),
    )
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    await waitFor(() => expect(within(panel).getByText('暂无已保存的站点数据')).toBeInTheDocument())
    expect(fetchSpy).toHaveBeenCalledWith('/api/browse/cookies/clear', {
      method: 'POST',
      credentials: 'same-origin',
    })
  })

  it('清除站点数据取消不发送请求；失败时保留确认框并显示错误（D1 审查）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ count: 1, origins: ['https://a.example'] }), { status: 200 }),
    )
    render(<BrowserApp />)
    await screen.findByTestId('browser-site-data')

    // 取消：不调用 clear 端点。
    fireEvent.click(screen.getByTestId('browser-site-data-clear'))
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/clear'))).toBe(false)

    // 失败：错误展示在确认框内，弹层不关闭。
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'x' }), { status: 500 }))
    fireEvent.click(screen.getByTestId('browser-site-data-clear'))
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('清除失败，请稍后重试。'),
    )
    expect(screen.getByRole('dialog', { name: '清除站点数据' })).toBeInTheDocument()
  })

  it('站点数据不可用时（本地预览/未登录）区块整体隐藏', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<BrowserApp />)
    expect(screen.queryByTestId('browser-site-data')).toBeNull()
    fetchSpy.mockRestore()
  })

  it('档 ③：引导成功 → iframe 用子域路径态 + allow-same-origin 沙箱', async () => {
    vi.stubEnv('VITE_BROWSE_ORIGIN', 'http://browse.local')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/browse/token')) {
        return new Response(JSON.stringify({ token: 'claim-token' }), { status: 200 })
      }
      if (url.includes('/api/browse/cookies')) {
        return new Response(JSON.stringify({ count: 0, origins: [] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    render(<BrowserApp />)

    // 引导页挂载（带令牌 hash）。
    const boot = await screen.findByTestId('browser-boot')
    expect(boot.getAttribute('src')).toBe('http://browse.local/__bootstrap#t=claim-token')

    // 子域回执：引导页卸载、进入 v3 模式。
    dispatchBrowseReady(true)
    await waitFor(() => expect(screen.queryByTestId('browser-boot')).toBeNull())

    navigate('example.com')
    const frame = activeFrame()
    expect(frame.getAttribute('src')).toBe('http://browse.local/https/example.com/')
    expect(frame.getAttribute('data-mode')).toBe('path')
    expect(frame.getAttribute('sandbox')).toContain('allow-same-origin')
  })

  it('档 ③：引导失败回执 → 静默回退 query 兜底模式（沙箱不含 allow-same-origin）', async () => {
    vi.stubEnv('VITE_BROWSE_ORIGIN', 'http://browse.local')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/browse/token')) {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      }
      return new Response(JSON.stringify({ count: 0, origins: [] }), { status: 200 })
    })
    render(<BrowserApp />)
    await screen.findByTestId('browser-boot')

    dispatchBrowseReady(false)
    await waitFor(() => expect(screen.queryByTestId('browser-boot')).toBeNull())

    navigate('example.com')
    const frame = activeFrame()
    expect(frame.getAttribute('src')).toBe(proxyUrlFor('https://example.com'))
    expect(frame.getAttribute('data-mode')).toBe('query')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('模式状态行：未配置增强源不显示；引导成功=增强；失败=受限', async () => {
    // ① 未配置（本地默认）→ 无状态行。
    vi.stubEnv('VITE_BROWSE_ORIGIN', '')
    vi.stubEnv('VITE_AUTH_BACKEND', '')
    const first = render(<BrowserApp />)
    expect(screen.queryByTestId('browser-mode')).toBeNull()
    first.unmount()

    // ② 配置了源：引导期间 pending。
    vi.stubEnv('VITE_BROWSE_ORIGIN', 'http://browse.local')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/browse/token')) {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      }
      return new Response(JSON.stringify({ count: 0, origins: [] }), { status: 200 })
    })
    const second = render(<BrowserApp />)
    expect(await screen.findByTestId('browser-mode')).toHaveTextContent('正在准备增强模式…')

    // ③ 失败回执 → 受限模式提示（明确告知可用新标签页逃生）。
    dispatchBrowseReady(false)
    await waitFor(() =>
      expect(screen.getByTestId('browser-mode')).toHaveTextContent('增强模式不可用（受限模式）'),
    )
    second.unmount()

    // ④ 成功回执 → 增强模式提示。
    const third = render(<BrowserApp />)
    await screen.findByTestId('browser-boot')
    dispatchBrowseReady(true)
    await waitFor(() =>
      expect(screen.getByTestId('browser-mode')).toHaveTextContent('增强模式已启用'),
    )
    third.unmount()
  })

  it('代理页请求新标签打开：window.open 真实 URL 并回执页面', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<BrowserApp />)
    navigate('example.com')
    const ack = vi.fn()
    const source = registerFrameSource(activeFrame(), ack)

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'agehaos:open-external', url: 'https://www.bilibili.com/video/BV1' },
          origin: window.location.origin,
          source,
        }),
      )
    })
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1',
      '_blank',
      'noopener,noreferrer',
    )
    expect(ack).toHaveBeenCalledWith({ type: 'agehaos:browse-open-external' }, '*')

    // 非 http(s) 目标一律忽略（防 javascript: 等注入面）。
    openSpy.mockClear()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'agehaos:open-external', url: 'javascript:alert(1)' },
          origin: window.location.origin,
          source,
        }),
      )
    })
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('伪造来源/未知 iframe 的消息一律忽略（D1 审查）', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<BrowserApp />)
    navigate('example.com')
    const frame = activeFrame()
    const source = registerFrameSource(frame)

    // ① 未知窗口源（不在已登记 iframe 集合）。
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'agehaos:open-external', url: 'https://evil.example' },
          origin: window.location.origin,
          source: { postMessage: vi.fn() } as unknown as Window,
        }),
      )
    })
    // ② 站外 origin（即使 source 恰好是真实 iframe）。
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'agehaos:open-external', url: 'https://evil.example' },
          origin: 'https://evil.example',
          source,
        }),
      )
    })
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('iframe 内导航回报：地址栏/书签跟随新位置，且不重载 iframe（D1 审查）', () => {
    render(<BrowserApp />)
    navigate('example.com')
    const frame = activeFrame()
    const source = registerFrameSource(frame)
    const srcBefore = frame.getAttribute('src')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'agehaos:browse-location',
            url: `${window.location.origin}/api/browse?url=${encodeURIComponent('https://example.com/page2')}`,
          },
          origin: window.location.origin,
          source,
        }),
      )
    })

    expect(addressInput().value).toBe('example.com/page2')
    // iframe 的 src 不变：页内历史由 iframe 自己维护，改 src 会打断/重载页面。
    expect(activeFrame().getAttribute('src')).toBe(srcBefore)
    expect(activeFrame().getAttribute('data-url')).toBe('https://example.com/page2')

    // 刷新跟随当前真实位置（不再弹回入栈 URL）。
    fireEvent.click(screen.getByTestId('browser-reload'))
    expect(activeFrame().getAttribute('src')).toBe(proxyUrlFor('https://example.com/page2'))
  })

  it('访问入历史：起始页最近访问列出并按序回访', () => {
    render(<BrowserApp />)
    navigate('a.example')
    navigate('b.example')
    fireEvent.click(screen.getByTestId('browser-new-tab'))

    const historyList = screen.getByTestId('browser-history-list')
    const rows = within(historyList).getAllByRole('button')
    expect(rows[0]).toHaveTextContent('b.example')
    expect(rows[1]).toHaveTextContent('a.example')
  })
})

describe('引导失败终结与同 URL 重入（D1 审查）', () => {
  it('token 接口非 2xx → bootDone（受限模式），不再永挂「正在准备增强模式」', async () => {
    vi.stubEnv('VITE_BROWSE_ORIGIN', 'http://browse.local')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/browse/token')) {
        return new Response('{}', { status: 502 })
      }
      if (String(input).includes('/api/browse/cookies')) {
        return new Response(JSON.stringify({ count: 0, origins: [] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    })
    try {
      render(<BrowserApp />)
      // 引导终结 = 起始页模式状态行（browser-mode 出现且 boot iframe 缺席）。
      await waitFor(() => expect(screen.getByTestId('browser-mode')).toBeInTheDocument())
      expect(screen.queryByTestId('browser-boot')).toBeNull()
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('同一 URL 再回车原位刷新（reloadSeq 递增、不追加 TrailEntry）', async () => {
    vi.stubEnv('VITE_BROWSE_ORIGIN', 'http://browse.local')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/browse/token')) {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      }
      if (url.includes('/api/browse/cookies')) {
        return new Response(JSON.stringify({ count: 0, origins: [] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    try {
      render(<BrowserApp />)
      await screen.findByTestId('browser-boot')
      dispatchBrowseReady(true)
      await waitFor(() => expect(screen.queryByTestId('browser-boot')).toBeNull())

      navigate('example.com')
      expect(screen.getAllByTestId('browser-iframe')).toHaveLength(1)
      // 同 URL 再回车：不追加条目/iframe（旧实现挂两个同址 iframe，后退
      // 回到内容相同的上一页）；原位刷新（reloadSeq 进 key 重挂）。
      navigate('example.com')
      expect(screen.getAllByTestId('browser-iframe')).toHaveLength(1)
      // 后退按钮不可用：trail 没有追加（index 仍在入栈位）。
      expect((screen.getByTestId('browser-back') as HTMLButtonElement).disabled).toBe(true)
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })
})
