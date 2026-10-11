import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CalculatorApp } from './CalculatorApp'

function press(key: string) {
  fireEvent.click(screen.getByTestId(`calculator-key-${key}`))
}

function display(): string {
  return (screen.getByTestId('calculator-display') as HTMLOutputElement).value
}

describe('CalculatorApp（PRD §26 P1）', () => {
  beforeEach(() => render(<CalculatorApp />))

  it('starts at zero', () => {
    expect(display()).toBe('0')
  })

  it('adds numbers with immediate execution', () => {
    for (const key of ['1', '2', '+', '3', '=']) press(key)
    expect(display()).toBe('15')
  })

  it('chains operations without pressing equals', () => {
    for (const key of ['2', '×', '3', '+', '1', '=']) press(key)
    expect(display()).toBe('7')
  })

  it('repeats the last operation on repeated equals', () => {
    for (const key of ['1', '2', '+', '3', '=', '=']) press(key)
    expect(display()).toBe('18')
  })

  it('handles decimals and sign flip', () => {
    for (const key of ['0', '.', '5', '±', '+', '1', '=']) press(key)
    expect(display()).toBe('0.5')
  })

  it('reports divide-by-zero as an error and recovers with C', () => {
    for (const key of ['5', '÷', '0', '=']) press(key)
    expect(display()).toBe('错误')
    press('C')
    expect(display()).toBe('0')
  })

  it('clears back to the initial state', () => {
    for (const key of ['9', '×', '9', '=']) press(key)
    press('C')
    expect(display()).toBe('0')
  })
})

/**
 * 窄容器分支（M3-4）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；几何级断言（命中
 * 区实测 / 显示区不截断 / 无横向溢出）归 e2e/mobile-calculator-store.spec.ts
 * 真实视口（与 NotesApp/FileManager 窄容器组同一分工口径）。
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

describe('CalculatorApp 窄容器（M3-4）', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithWidth(width: number) {
    render(<CalculatorApp />)
    act(() => {
      FakeResizeObserver.instances.at(-1)?.emit(width)
    })
  }

  it('窄容器：按键命中区抬到 ≥44px 触控档（min-h 类 + 触压反馈），计算流程可用', () => {
    renderWithWidth(360)

    for (const key of ['7', '×', '8', '=']) press(key)
    expect(display()).toBe('56')

    // 触控档：min-h-[44px]（§35.3）+ active 触压，无桌面 text-sm 小档。
    for (const key of ['7', '×', '8', '=', 'C']) {
      const className = screen.getByTestId(`calculator-key-${key}`).className
      expect(className).toContain('min-h-[44px]')
      expect(className).toContain('active:opacity-80')
      expect(className).not.toContain('text-sm')
    }
  })

  it('宽容器：按键类名与改前字面等价（无触控档类）', () => {
    render(<CalculatorApp />)

    // 逐字钉住改前模板产物（含尾随空格），防后续重构悄悄动桌面 DOM。
    expect(screen.getByTestId('calculator-key-7').className).toBe(
      'rounded-md text-sm font-medium tabular-nums bg-surface-raised/60 text-text hover:bg-surface-raised ',
    )
    expect(screen.getByTestId('calculator-key-=').className).toBe(
      'rounded-md text-sm font-medium tabular-nums bg-primary text-primary-contrast hover:opacity-90 ',
    )
  })
})
