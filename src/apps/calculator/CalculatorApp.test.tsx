import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

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
