import { describe, expect, it } from 'vitest'

import {
  averageBrightness,
  blendHex,
  contrastRatio,
  hexToRgb,
  relativeLuminance,
} from './contrast'

describe('WCAG contrast math (§6.2)', () => {
  it('computes canonical contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // WCAG 参考例：#767676 vs 白 ≈ 4.54（AA 恰好通过）
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5)
  })

  it('is symmetric and tolerant of case', () => {
    expect(contrastRatio('#1A1D29', '#e8eaf2')).toBe(contrastRatio('#e8eaf2', '#1a1d29'))
  })

  it('returns null for invalid colors', () => {
    expect(contrastRatio('#12345', '#ffffff')).toBeNull()
    expect(hexToRgb('nope')).toBeNull()
  })

  it('computes relative luminance endpoints', () => {
    expect(relativeLuminance(hexToRgb('#000000')!)).toBe(0)
    expect(relativeLuminance(hexToRgb('#ffffff')!)).toBeCloseTo(1, 5)
  })

  it('blends a foreground over a background (scrim math)', () => {
    expect(blendHex('#ffffff', '#000000', 1)).toBe('#ffffff')
    expect(blendHex('#ffffff', '#000000', 0)).toBe('#000000')
    expect(blendHex('#808080', '#000000', 0.5)).toBe('#404040')
    expect(blendHex('bad', '#000000', 0.5)).toBeNull()
  })

  it('averages brightness across stops and rejects invalid entries', () => {
    expect(averageBrightness(['#000000', '#ffffff'])).toBeCloseTo(0.5, 5)
    expect(averageBrightness(['#zzzzzz'])).toBeNull()
    expect(averageBrightness([])).toBeNull()
  })
})
