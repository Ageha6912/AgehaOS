import { describe, expect, it } from 'vitest'

import { hexToRgb, relativeLuminance } from '../governance/contrast'
import { compatiblePalettes, isCompatible, PALETTES } from './palettes'
import type { Palette } from '../types'

describe('palette catalog (§4.3)', () => {
  it('contains exactly 24 curated palettes with unique ids', () => {
    expect(PALETTES).toHaveLength(24)
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(24)
  })

  it('covers the 2×2 family grid with 6 palettes each (§10.2 prior)', () => {
    for (const lightness of ['dark', 'light'] as const) {
      for (const saturation of ['high', 'low'] as const) {
        const count = PALETTES.filter(
          (p) => p.family.lightness === lightness && p.family.saturation === saturation,
        ).length
        expect(count).toBe(6)
      }
    }
  })

  it('uses only valid hex colors in 3–4 stops', () => {
    for (const palette of PALETTES) {
      expect(palette.stops.length).toBeGreaterThanOrEqual(3)
      expect(palette.stops.length).toBeLessThanOrEqual(4)
      for (const stop of [...palette.stops, palette.accent]) {
        expect(hexToRgb(stop), `${palette.id}: ${stop}`).not.toBeNull()
      }
    }
  })
})

describe('style × palette compatibility (§4.3)', () => {
  const palette = (lightness: 'dark' | 'light', saturation: 'high' | 'low'): Palette => ({
    id: 'probe',
    family: { lightness, saturation },
    stops: ['#000000', '#111111'],
    accent: '#222222',
  })

  it('restricts particle-nebula to dark palettes', () => {
    expect(isCompatible('particle-nebula', palette('dark', 'low'))).toBe(true)
    expect(isCompatible('particle-nebula', palette('light', 'low'))).toBe(false)
  })

  it('restricts mountain-silhouette to low-saturation palettes', () => {
    expect(isCompatible('mountain-silhouette', palette('dark', 'low'))).toBe(true)
    expect(isCompatible('mountain-silhouette', palette('dark', 'high'))).toBe(false)
  })

  it('keeps at least a dozen compatible palettes for every style', () => {
    for (const style of [
      'fluid-gradient',
      'geometric',
      'particle-nebula',
      'mountain-silhouette',
      'grid-wavefield',
    ] as const) {
      expect(compatiblePalettes(style).length).toBeGreaterThanOrEqual(12)
    }
  })
})

describe('palette quality sanity', () => {
  it('dark palettes are darker than light ones in relative luminance', () => {
    const avgLuminance = (palette: Palette) =>
      palette.stops.reduce((sum, stop) => sum + relativeLuminance(hexToRgb(stop)!), 0) /
      palette.stops.length
    for (const palette of PALETTES) {
      const value = avgLuminance(palette)
      if (palette.family.lightness === 'dark') expect(value).toBeLessThan(0.2)
      else expect(value).toBeGreaterThan(0.4)
    }
  })
})
