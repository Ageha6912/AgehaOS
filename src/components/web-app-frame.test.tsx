import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { APP_READY_TYPE } from '@/core/apps/web-app'
import { permissionManager } from '@/core/permissions'

import { WebAppFrame } from './web-app-frame'

/**
 * jsdom 的 iframe.contentWindow 是真实的 about:blank 窗口对象，可直接作为
 * event.source 模拟「来自该 iframe」的消息；父 window 作为 source 则模拟外部。
 */

function eventFrom(source: Window | null, data: unknown) {
  return new MessageEvent('message', { data, source })
}

const PROPS = {
  entry: '/apps/sites/clock/index.html',
  appId: 'com.ageha.samples.clock',
  windowId: 'w1',
  title: '时钟',
}

describe('WebAppFrame（Type B 宿主，§30.3）', () => {
  it('renders a sandboxed iframe restricted to allow-scripts (opaque origin)', () => {
    render(<WebAppFrame {...PROPS} />)
    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('src')).toBe('/apps/sites/clock/index.html')
  })

  it('refuses to render entries outside the allowlist', () => {
    render(<WebAppFrame {...PROPS} entry="https://evil.example.com/app.html" />)
    expect(screen.getByText('该应用的内容来源不受支持，已被阻止加载。')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('shows a loading veil and reveals the app on iframe load', async () => {
    render(<WebAppFrame {...PROPS} />)
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()

    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    fireEvent.load(iframe)

    await waitFor(() => expect(screen.queryByTestId('web-app-loading')).toBeNull())
  })

  it('resets the loading veil and remounts the iframe when the entry changes (E3 审查)', async () => {
    const { rerender } = render(<WebAppFrame {...PROPS} />)
    const first = document.querySelector('iframe') as HTMLIFrameElement
    fireEvent.load(first)
    await waitFor(() => expect(screen.queryByTestId('web-app-loading')).toBeNull())

    rerender(<WebAppFrame {...PROPS} entry="/apps/sites/notes/index.html" />)
    const second = document.querySelector('iframe') as HTMLIFrameElement
    // 新 entry：iframe 重挂（旧文档的迟到消息不再落到新文档）+ 加载遮罩回归。
    expect(second).not.toBe(first)
    expect(second.getAttribute('src')).toBe('/apps/sites/notes/index.html')
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()
  })

  it('reveals on a ready handshake from the iframe and drops foreign ones', async () => {
    render(<WebAppFrame {...PROPS} />)
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()

    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    const appWindow = iframe.contentWindow as Window | null

    // 来自外部窗口的 ready 消息被丢弃。
    window.dispatchEvent(eventFrom(window, { type: APP_READY_TYPE }))
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()

    // 来自 iframe 自身的合法 ready 消息揭示内容。
    window.dispatchEvent(eventFrom(appWindow, { type: APP_READY_TYPE }))
    await waitFor(() => expect(screen.queryByTestId('web-app-loading')).toBeNull())
  })

  it('drops malformed handshake payloads from the iframe', () => {
    render(<WebAppFrame {...PROPS} />)
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    window.dispatchEvent(eventFrom(iframe.contentWindow as Window | null, { type: 'agehaos:exec', cmd: 'x' }))
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()
  })
})

describe('WebAppFrame × SDK 桥（Type C，§30.1）', () => {
  it('executes permitted storage requests and replies to the requesting window', async () => {
    localStorage.clear()
    permissionManager.grant('com.ageha.samples.clock', 'storage')
    render(<WebAppFrame {...PROPS} />)
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    const appWindow = iframe.contentWindow as Window
    const reply = vi.fn()
    appWindow.postMessage = reply

    window.dispatchEvent(
      eventFrom(appWindow, {
        type: 'agehaos:sdk',
        reqId: 'r1',
        api: 'storage',
        action: 'set',
        params: { key: 'greeting', value: 'hi' },
      }),
    )

    await waitFor(() => expect(reply).toHaveBeenCalled())
    const payload = reply.mock.calls[0][0] as { type: string; reqId: string; ok: boolean }
    expect(payload).toMatchObject({ type: 'agehaos:sdk-result', reqId: 'r1', ok: true })
    // Scoped Access：数据落在按 appId 命名空间隔离的键下。
    expect(localStorage.getItem('agehaos.sdk.storage.com.ageha.samples.clock')).toContain('"greeting":"hi"')
  })

  it('denies storage requests without the grant and audits permission.denied', async () => {
    localStorage.clear()
    permissionManager.forgetApp('com.ageha.samples.clock')
    render(<WebAppFrame {...PROPS} />)
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    const appWindow = iframe.contentWindow as Window
    const reply = vi.fn()
    appWindow.postMessage = reply

    window.dispatchEvent(
      eventFrom(appWindow, {
        type: 'agehaos:sdk',
        reqId: 'r2',
        api: 'storage',
        action: 'get',
        params: { key: 'greeting' },
      }),
    )

    await waitFor(() => expect(reply).toHaveBeenCalled())
    expect(reply.mock.calls[0][0]).toMatchObject({ reqId: 'r2', ok: false, error: 'permission-denied' })
  })

  it('updates the window title through the window permission', async () => {
    const { useWindowStore } = await import('@/store/window-store')
    const windowId = useWindowStore.getState().open({ appId: 'com.ageha.samples.clock', title: '时钟' })
    permissionManager.grant('com.ageha.samples.clock', 'window')
    render(<WebAppFrame {...PROPS} windowId={windowId} />)
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    const appWindow = iframe.contentWindow as Window
    const reply = vi.fn()
    appWindow.postMessage = reply

    window.dispatchEvent(
      eventFrom(appWindow, {
        type: 'agehaos:sdk',
        reqId: 'r3',
        api: 'window',
        action: 'setTitle',
        params: { title: '时钟 · 已就绪' },
      }),
    )

    await waitFor(() => expect(reply).toHaveBeenCalled())
    expect(useWindowStore.getState().windows.find((win) => win.id === windowId)?.title).toBe('时钟 · 已就绪')
  })
})
