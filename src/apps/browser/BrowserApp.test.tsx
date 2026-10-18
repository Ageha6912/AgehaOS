import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ cleared: true }), { status: 200 }))
    fireEvent.click(screen.getByTestId('browser-site-data-clear'))
    await waitFor(() => expect(within(panel).getByText('暂无已保存的站点数据')).toBeInTheDocument())
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/browse/cookies/clear', {
      method: 'POST',
      credentials: 'same-origin',
    })
  })

  it('站点数据不可用时（本地预览/未登录）区块整体隐藏', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<BrowserApp />)
    expect(screen.queryByTestId('browser-site-data')).toBeNull()
    fetchSpy.mockRestore()
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
