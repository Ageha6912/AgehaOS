import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { APP_READY_TYPE } from '@/core/apps/web-app'

import { WebAppFrame } from './web-app-frame'

/**
 * jsdom 不实现 iframe 内容窗口：contentWindow 为 null。组件的 source 校验
 * `event.source !== iframe.contentWindow` 在此语义下——source 为 null 的事件
 * 视为「来自该 iframe」，source 为 window 的事件视为「来自外部」并丢弃。
 */

function eventFrom(source: Window | null, data: unknown) {
  return new MessageEvent('message', { data, source })
}

describe('WebAppFrame（Type B 宿主，§30.3）', () => {
  it('renders a sandboxed iframe restricted to allow-scripts (opaque origin)', () => {
    render(<WebAppFrame entry="/apps/sites/clock/index.html" title="时钟" />)
    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('src')).toBe('/apps/sites/clock/index.html')
  })

  it('refuses to render entries outside the allowlist', () => {
    render(<WebAppFrame entry="https://evil.example.com/app.html" title="bad" />)
    expect(screen.getByText('该应用的内容来源不受支持，已被阻止加载。')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('shows a loading veil and reveals the app on iframe load', async () => {
    render(<WebAppFrame entry="/apps/sites/clock/index.html" title="时钟" />)
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()

    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    fireEvent.load(iframe)

    await waitFor(() => expect(screen.queryByTestId('web-app-loading')).toBeNull())
  })

  it('reveals on a ready handshake from the iframe and drops foreign ones', async () => {
    render(<WebAppFrame entry="/apps/sites/clock/index.html" title="时钟" />)
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
    render(<WebAppFrame entry="/apps/sites/clock/index.html" title="时钟" />)
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    window.dispatchEvent(eventFrom(iframe.contentWindow as Window | null, { type: 'agehaos:exec', cmd: 'x' }))
    expect(screen.getByTestId('web-app-loading')).toBeInTheDocument()
  })
})
