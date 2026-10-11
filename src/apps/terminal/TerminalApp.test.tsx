import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  detectDeviceCapabilities,
} from '@/core/platform/device-capabilities'
import { useDeviceStore } from '@/store/device-store'
import { seedSessionForTests } from '@/store/session-store'

import { keyboardInsetPx } from './keyboard-inset'
import { TerminalApp } from './TerminalApp'

beforeEach(() => {
  seedSessionForTests({ id: 'u-t', username: 'alice', createdAt: '', updatedAt: '' })
})

async function runCommand(command: string): Promise<void> {
  const input = screen.getByTestId('terminal-input')
  await userEvent.type(input, command)
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('TerminalApp (PRD §26)', () => {
  it('exposes the terminal-input hook the stylesheet uses to drop the focus ring', () => {
    render(<TerminalApp />)

    // index.css 以 [data-testid='terminal-input']:focus-visible 关闭全局焦点环
    // （终端本身就是焦点所在）；此断言固定该选择器契约，防止改名导致焦点环回归。
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument()
  })

  it('echoes the prompt and command output', async () => {
    render(<TerminalApp />)

    await runCommand('pwd')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('/'),
    )
    expect(screen.getByTestId('terminal-output').textContent).toContain('alice@agehaos')
  })

  it('creates a file with touch and lists it', async () => {
    render(<TerminalApp />)

    await runCommand('touch hello.txt')
    await runCommand('ls')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('hello.txt'),
    )
  })

  it('reports unknown commands with the localized error', async () => {
    render(<TerminalApp />)

    await runCommand('frobnicate')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('未知命令：frobnicate'),
    )
  })

  it('clears the output on the clear command', async () => {
    render(<TerminalApp />)

    await runCommand('pwd')
    await waitFor(() => expect(screen.getByTestId('terminal-output').textContent).toContain('pwd'))
    await runCommand('clear')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).not.toContain('pwd'),
    )
  })

  it('recalls previous commands with the arrow keys', async () => {
    render(<TerminalApp />)

    await runCommand('whoami')
    await waitFor(() => expect(screen.getByTestId('terminal-output').textContent).toContain('alice'))

    const input = screen.getByTestId('terminal-input')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('whoami')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('')
  })

  it('renders error tone for failed commands', async () => {
    render(<TerminalApp />)

    await runCommand('cat missing.txt')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('/missing.txt：不存在'),
    )
  })
})

describe('keyboardInsetPx（M3-5 软键盘遮挡纯函数）', () => {
  it('遮挡 = 布局视口高 − visualViewport 可视段（offsetTop + height）', () => {
    expect(keyboardInsetPx(800, { offsetTop: 0, height: 300 })).toBe(500)
    expect(keyboardInsetPx(800, { offsetTop: 100, height: 300 })).toBe(400)
  })

  it('键盘未遮挡（可视段覆盖全视口）回 0；读数异常回 0 绝不抛错', () => {
    expect(keyboardInsetPx(800, { offsetTop: 0, height: 800 })).toBe(0)
    expect(keyboardInsetPx(800, { offsetTop: 0, height: 900 })).toBe(0)
    expect(keyboardInsetPx(0, { offsetTop: 0, height: 300 })).toBe(0)
    expect(keyboardInsetPx(800, { offsetTop: 0, height: 0 })).toBe(0)
  })
})

/**
 * 窄容器分支（M3-5）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；真实几何（命中区
 * 实测 / 折行不溢出 / 零横向溢出）归 e2e/mobile-terminal-panel.spec.ts
 * （与 Calculator 窄容器组同一分工口径）。软键盘避让 stub visualViewport
 * 喂 resize 事件钉样式直写与清理；真机键盘行为归真机冒烟（E2E 无法模拟
 * 软键盘弹起，见 spec 文件头注释）。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** 手动喂一次观测回调（内容盒宽度）。真实 RO 在 observe 时必发初始帧。 */
  emit(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

class FakeVisualViewport {
  listeners = new Set<() => void>()
  offsetTop = 0
  height = 768
  addEventListener(type: string, listener: () => void): void {
    if (type === 'resize' || type === 'scroll') this.listeners.add(listener)
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener)
  }
  emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** 等过 rAF 合帧（组件在 rAF 缺席时同步 flush，两者都被这个 await 覆盖）。 */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve(null))
      } else {
        setTimeout(resolve, 0)
      }
    })
  })
}

describe('TerminalApp 窄容器（M3-5）', () => {
  beforeEach(() => {
    seedSessionForTests({ id: 'u-t', username: 'alice', createdAt: '', updatedAt: '' })
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useDeviceStore.setState({
      capabilities: detectDeviceCapabilities(),
      shell: 'desktop',
    })
  })

  function renderWithWidth(width: number): void {
    render(<TerminalApp />)
    act(() => {
      FakeResizeObserver.instances.at(-1)?.emit(width)
    })
  }

  it('窄容器：16px 字号档 + 输入行触控档类 + 软键盘修正属性 + 输出井收滚动链；命令流程可用', async () => {
    renderWithWidth(360)

    const root = screen.getByTestId('terminal-root')
    expect(root.className).toContain('text-base')
    expect(root.className).not.toContain('text-xs')
    const well = screen.getByTestId('terminal-output')
    expect(well.className).toContain('overscroll-contain')

    const input = screen.getByTestId('terminal-input')
    expect(input.className).toContain('min-h-[44px]')
    expect(input).toHaveAttribute('autocapitalize', 'off')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('enterkeyhint', 'send')

    await userEvent.type(input, 'pwd')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('alice@agehaos'),
    )
  })

  it('宽容器：根/井/输入行类名与改前字面等价，无软键盘修正属性', () => {
    render(<TerminalApp />)

    expect(screen.getByTestId('terminal-root').className).toBe(
      'surface-panel flex h-full flex-col font-mono text-xs',
    )
    expect(screen.getByTestId('terminal-output').className).toBe(
      'm-2 min-h-0 flex-1 overflow-y-auto rounded-md bg-surface-raised/60 p-3 leading-relaxed',
    )
    const input = screen.getByTestId('terminal-input')
    expect(input.className).toBe(
      'min-w-0 flex-1 bg-transparent text-text caret-primary focus-visible:outline-none',
    )
    expect(input).not.toHaveAttribute('autocapitalize')
    expect(input).not.toHaveAttribute('autocorrect')
    expect(input).not.toHaveAttribute('enterkeyhint')
  })

  it('软键盘避让：触屏下键盘弹起根让出遮挡高度、收起恢复、卸载清理监听', async () => {
    useDeviceStore.setState({
      capabilities: { ...useDeviceStore.getState().capabilities, isTouch: true },
    })
    const fakeVV = new FakeVisualViewport()
    vi.stubGlobal('visualViewport', fakeVV)

    const { unmount } = render(<TerminalApp />)
    act(() => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })

    // 软键盘弹起：可视段 300px，遮挡 768 − 300 = 468px。
    fakeVV.height = 300
    act(() => {
      fakeVV.emit()
    })
    await flushFrame()
    expect(screen.getByTestId('terminal-root').style.height).toBe('calc(100% - 468px)')

    // 键盘收起：高度让位撤销（回落类名控高）。
    fakeVV.height = 768
    act(() => {
      fakeVV.emit()
    })
    await flushFrame()
    expect(screen.getByTestId('terminal-root').style.height).toBe('')

    unmount()
    expect(fakeVV.listeners.size).toBe(0)
  })

  it('非触屏（桌面窄窗口）：visualViewport 不接管——缩放不改变形', async () => {
    // jsdom 默认探针 isTouch=false（能力判定集中 device-store，铁律豁免点）。
    expect(useDeviceStore.getState().capabilities.isTouch).toBe(false)
    const fakeVV = new FakeVisualViewport()
    vi.stubGlobal('visualViewport', fakeVV)

    const { unmount } = render(<TerminalApp />)
    act(() => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })

    fakeVV.height = 300
    act(() => {
      fakeVV.emit()
    })
    await flushFrame()
    expect(screen.getByTestId('terminal-root').style.height).toBe('')

    unmount()
    expect(fakeVV.listeners.size).toBe(0)
  })
})
