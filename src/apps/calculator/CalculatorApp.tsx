import { useCallback, useEffect, useState } from 'react'

import { useTranslation } from '@/core/i18n'

/**
 * Calculator（PRD §26 P1）：经典即时执行模型——数字进 current，
 * 运算符把 (accumulator, op) 挂起，等号结算。纯状态机，无 eval。
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

export function CalculatorApp() {
  const { t } = useTranslation()
  const [state, setState] = useState<CalcState>(INITIAL)

  const press = useCallback((key: string) => setState((s) => pressKey(s, key)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
  }, [press])

  return (
    <div className="flex h-full flex-col bg-surface" aria-label={t('app.calculator.title')}>
      <output
        data-testid="calculator-display"
        className="select-none border-b border-border px-4 py-4 text-right text-2xl font-semibold tabular-nums text-text"
      >
        {state.display}
      </output>
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-1 p-2">
        {BUTTONS.map((button) => (
          <button
            key={button.key}
            type="button"
            data-testid={`calculator-key-${button.key}`}
            className={`rounded-md text-sm font-medium ${
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
