import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyUrlFor, searchUrlFor } from './browser-nav'
import { resetBrowserStore, useBrowserStore } from './browser-store'
import { BrowserApp } from './BrowserApp'

/**
 * 浏览器应用（档 C）：地址栏（域名直访 / 关键词搜索）、标签页、后退/前进、
 * 星标收藏、新标签打开、起始页书签与最近访问。iframe 的 src = 代理地址是
 * 全链路契约的客户端半场（服务端半场在 server/test/browse.test.ts）。
 */

beforeEach(() => {
  resetBrowserStore()
})

function addressInput(): HTMLInputElement {
  return screen.getByTestId('browser-address') as HTMLInputElement
}

function iframeSrc(): string | null {
  return screen.getByTestId('browser-iframe').getAttribute('src')
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

    fireEvent.change(addressInput(), { target: { value: 'example.com/a' } })
    fireEvent.keyDown(addressInput(), { key: 'Enter' })
    expect(iframeSrc()).toBe(proxyUrlFor('https://example.com/a'))

    fireEvent.change(addressInput(), { target: { value: '北京 天气' } })
    fireEvent.keyDown(addressInput(), { key: 'Enter' })
    expect(iframeSrc()).toBe(proxyUrlFor(searchUrlFor('北京 天气')))
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

  it('后退/前进沿 trail 移动；刷新换 iframe key 重载', () => {
    render(<BrowserApp />)
    const navigate = (value: string): void => {
      fireEvent.change(addressInput(), { target: { value } })
      fireEvent.keyDown(addressInput(), { key: 'Enter' })
    }

    navigate('a.example')
    navigate('b.example')
    expect(iframeSrc()).toBe(proxyUrlFor('https://b.example'))

    fireEvent.click(screen.getByTestId('browser-back'))
    expect(iframeSrc()).toBe(proxyUrlFor('https://a.example'))
    fireEvent.click(screen.getByTestId('browser-forward'))
    expect(iframeSrc()).toBe(proxyUrlFor('https://b.example'))

    // 刷新：relabel key（同 src 不重载的 React 语义）——key 变化即重挂。
    const before = screen.getByTestId('browser-iframe')
    fireEvent.click(screen.getByTestId('browser-reload'))
    expect(screen.getByTestId('browser-iframe')).not.toBe(before)
    expect(iframeSrc()).toBe(proxyUrlFor('https://b.example'))
  })

  it('星标收藏/取消 + 起始页书签列表可回访', () => {
    render(<BrowserApp />)
    fireEvent.change(addressInput(), { target: { value: 'example.com' } })
    fireEvent.keyDown(addressInput(), { key: 'Enter' })

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
    expect(iframeSrc()).toBe(proxyUrlFor('https://example.com'))

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

  it('在新标签页打开：window.open 真实地址（非代理地址）+ noopener', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<BrowserApp />)
    fireEvent.change(addressInput(), { target: { value: 'example.com' } })
    fireEvent.keyDown(addressInput(), { key: 'Enter' })

    fireEvent.click(screen.getByTestId('browser-open-external'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('访问入历史：起始页最近访问列出并按序回访', () => {
    render(<BrowserApp />)
    const navigate = (value: string): void => {
      fireEvent.change(addressInput(), { target: { value } })
      fireEvent.keyDown(addressInput(), { key: 'Enter' })
    }
    navigate('a.example')
    navigate('b.example')
    fireEvent.click(screen.getByTestId('browser-new-tab'))

    const historyList = screen.getByTestId('browser-history-list')
    const rows = within(historyList).getAllByRole('button')
    expect(rows[0]).toHaveTextContent('b.example')
    expect(rows[1]).toHaveTextContent('a.example')
  })
})
