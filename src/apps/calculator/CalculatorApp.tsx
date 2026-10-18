import { useCallback, useEffect, useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import { useNarrowContainer } from '@/apps/use-narrow-container'

/**
 * Calculator（PRD §26 P1）：经典即时执行模型——数字进 current，
 * 运算符把 (accumulator, op) 挂起，等号结算。纯状态机，无 eval。
 *
 * 窄容器适配（M3-4）：按键网格触控化——根内容盒 <560px 时按键命中区抬到
 * ≥44px（DESIGN.md §35.3）、间距放宽、加触压反馈。显示区宽窄同档（text-2xl
 * 等宽字体，输入上限 14 位数字 ⇒ 至多 16 字符 ≈ 230px，360px 视口内容盒
 * ~328px 装得下，不截断；几何归 e2e/mobile-calculator-store.spec.ts 断言）。
 * use-narrow-container 契约：与设备判定无关（桌面窄窗口同样进窄分支）、
 * 禁视口 media query、宽容器 DOM 字面等价（类名模板宽档逐字保留）。
 */

type Operator = '+' | '-' | '×' | '÷'

interface CalcState {
  /** 已结算/正在输入的显示值。 */
  display: string
  accumulator: number | null
  pending: Operator | null
  /** 上一次完整的操作数与运算符（连续按 = 时重复应用）。 */
  lastOperand: number | null
  /** 正在输入新数字（而非追加到结果）。 */
  freshEntry: boolean
  error: string | null
}

const INITIAL: CalcState = {
  display: '0',
  accumulator: null,
  pending: null,
  lastOperand: null,
  freshEntry: true,
  error: null,
}

const MAX_DISPLAY_LENGTH = 14

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '错误'
  const rounded = Math.round(value * 1e10) / 1e10
  if (Math.abs(rounded) >= 1e14 || (rounded !== 0 && Math.abs(rounded) < 1e-10)) {
    return rounded.toExponential(6)
  }
  return String(rounded)
}

function apply(operator: Operator, a: number, b: number): number {
  switch (operator) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '×':
      return a * b
    case '÷':
      return a / b
  }
}

function pressKey(state: CalcState, key: string): CalcState {
  if (state.error && key !== 'C') return state
  if (key === 'C') return INITIAL

  if (key >= '0' && key <= '9') {
    if (state.freshEntry) {
      return { ...state, display: key, freshEntry: false }
    }
    if (state.display.replace(/[-.]/g, '').length >= MAX_DISPLAY_LENGTH) return state
    const next = state.display === '0' ? key : state.display + key
    return { ...state, display: next }
  }

  if (key === '.') {
    if (state.freshEntry) return { ...state, display: '0.', freshEntry: false }
    if (state.display.includes('.')) return state
    return { ...state, display: `${state.display}.` }
  }

  if (key === '±') {
    if (state.display === '0' || state.display === '错误') return state
    return {
      ...state,
      display: state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`,
    }
  }

  if (key === '+' || key === '-' || key === '×' || key === '÷') {
    const current = Number(state.display)
    if (state.pending !== null && !state.freshEntry && state.accumulator !== null) {
      const result = apply(state.pending, state.accumulator, current)
      return {
        ...state,
        display: formatNumber(result),
        accumulator: result,
        pending: key,
        freshEntry: true,
      }
    }
    return { ...state, accumulator: current, pending: key, freshEntry: true }
  }

  if (key === '=') {
    if (state.pending === null || state.accumulator === null) return { ...state, freshEntry: true }
    // 连续 =：把上次操作数重复应用到累计结果上（12 + 3 = = = → 15, 18, 21）。
    const operand = state.freshEntry
      ? (state.lastOperand ?? Number(state.display))
      : Number(state.display)
    const result = apply(state.pending, state.accumulator, operand)
    if (!Number.isFinite(result)) {
      return { ...INITIAL, display: '错误', error: 'divide-by-zero' }
    }
    return {
      ...state,
      display: formatNumber(result),
      accumulator: result,
      lastOperand: operand,
      freshEntry: true,
      error: null,
    }
  }

  if (key === '%') {
    const value = Number(state.display) / 100
    return { ...state, display: formatNumber(value), freshEntry: true }
  }

  return state
}

const BUTTONS: Array<{ key: string; label: string; kind: 'num' | 'fn' | 'op' | 'eq'; wide?: boolean }> = [
  { key: 'C', label: 'C', kind: 'fn' },
  { key: '±', label: '±', kind: 'fn' },
  { key: '%', label: '%', kind: 'fn' },
  { key: '÷', label: '÷', kind: 'op' },
  { key: '7', label: '7', kind: 'num' },
  { key: '8', label: '8', kind: 'num' },
  { key: '9', label: '9', kind: 'num' },
  { key: '×', label: '×', kind: 'op' },
  { key: '4', label: '4', kind: 'num' },
  { key: '5', label: '5', kind: 'num' },
  { key: '6', label: '6', kind: 'num' },
  { key: '-', label: '-', kind: 'op' },
  { key: '1', label: '1', kind: 'num' },
  { key: '2', label: '2', kind: 'num' },
  { key: '3', label: '3', kind: 'num' },
  { key: '+', label: '+', kind: 'op' },
  { key: '0', label: '0', kind: 'num', wide: true },
  { key: '.', label: '.', kind: 'num' },
  { key: '=', label: '=', kind: 'eq' },
]

const KEYBOARD_MAP: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '×',
  x: '×',
  '/': '÷',
  Enter: '=',
  '=': '=',
  Escape: 'C',
  '%': '%',
}

/** 可编辑元素（输入字段/文本域/下拉/富文本）：物理键盘的按键属于它们。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || EDITABLE_TAGS.has(target.tagName))
  )
}

export interface CalculatorAppProps {
  /** 宿主窗口 id；缺省（直接挂载/预览）视为聚焦窗口（守卫二回退）。 */
  windowId?: string
}

/**
 * 物理键盘监听的作用域守卫（2026-10-18 用户 bug 修复）：window 级 keydown
 * 此前无任何守卫，计算器一旦被打开过（组件保持挂载，即使窗口失焦/被盖住），
 * 全系统所有输入框的 0-9、运算符标点、Backspace 都被 preventDefault 吞掉
 * ——地址栏/搜索框「打不进数字标点、退格失效」。两层守卫：
 * ① 可编辑字段豁免：焦点在 input/textarea/可编辑区内一律让位；
 * ② 聚焦窗口门控：仅当本窗口聚焦（或有 windowId 缺失的回退档）才接管。
 */
export function CalculatorApp({ windowId }: CalculatorAppProps = {}) {
  const { t } = useTranslation()
  // 窄容器分支（M3-4）：观测应用根内容盒宽，与设备判定（device-store）无关
  // ——桌面窄窗口同样进入窄分支，移动宽视口保持宽布局。
  const { ref: rootRef, narrow } = useNarrowContainer()
  const [state, setState] = useState<CalcState>(INITIAL)

  const press = useCallback((key: string) => setState((s) => pressKey(s, key)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 守卫一（2026-10-18 用户 bug）：焦点在可编辑字段内，数字/标点/退格
      // 属于该字段的输入——绝不 preventDefault。
      if (isEditableTarget(event.target)) return
      // 守卫二：仅聚焦窗口接管物理键盘（windowId 缺失视为聚焦回退）。
      if (windowId !== undefined) {
        const focused = useWindowStore.getState().windows.find((w) => w.id === windowId)?.focused
        if (focused !== true) return
      }
      const mapped = KEYBOARD_MAP[event.key] ?? event.key
      if (/^[0-9]$/.test(mapped) || ['+', '-', '×', '÷', '=', 'C', '.', '%', '±'].includes(mapped)) {
        event.preventDefault()
        press(mapped)
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        setState((s) => (s.display.length > 1 && !s.freshEntry ? { ...s, display: s.display.slice(0, -1) } : s))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, windowId])

  return (
    <div ref={rootRef} className="surface-panel flex h-full flex-col" aria-label={t('app.calculator.title')}>
      <output
        data-testid="calculator-display"
        className="select-none border-b border-border px-4 py-4 text-right font-mono text-2xl font-semibold tabular-nums text-text"
      >
        {state.display}
      </output>
      {/* 窄容器（移动全屏视图 / 小窗口）：间距放宽 + 按键命中区 ≥44px
          （§35.3）+ 触压反馈（与 MobileAppGrid/MobileDock 的 active 同档）。
          宽容器（桌面）：类名与改前逐字一致。 */}
      <div className={`grid min-h-0 flex-1 grid-cols-4 ${narrow ? 'gap-2 p-3' : 'gap-1.5 p-2.5'}`}>
        {BUTTONS.map((button) => (
          <button
            key={button.key}
            type="button"
            data-testid={`calculator-key-${button.key}`}
            className={`rounded-md ${narrow ? 'min-h-[44px] text-base active:opacity-80' : 'text-sm'} font-medium tabular-nums ${
              button.kind === 'eq'
                ? 'bg-primary text-primary-contrast hover:opacity-90'
                : button.kind === 'op'
                  ? 'bg-surface-raised text-primary hover:bg-surface-raised/70'
                  : button.kind === 'fn'
                    ? 'bg-surface-raised/60 text-text-muted hover:bg-surface-raised hover:text-text'
                    : 'bg-surface-raised/60 text-text hover:bg-surface-raised'
            } ${button.wide ? 'col-span-2' : ''}`}
            onClick={() => press(button.key)}
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  )
}
