import { describe, expect, it } from 'vitest'

import { APP_UI_META } from './builtin'
import {
  APP_BADGES,
  BADGE_GLYPHS,
  BADGE_PALETTES,
  badgeForAppId,
  badgeForAppIdWithHue,
} from './app-badges'

describe('app badges (DESIGN.md §8)', () => {
  it('curates a badge for every builtin app', () => {
    for (const appId of Object.keys(APP_UI_META)) {
      expect(APP_BADGES[appId], `missing curated badge for ${appId}`).toBeDefined()
    }
  })

  it('curates badges for the bundled store samples', () => {
    for (const appId of [
      'com.ageha.samples.clock',
      'com.ageha.samples.sketch',
      'com.ageha.samples.sticky',
      'com.ageha.samples.fs-note',
      'com.ageha.samples.counter',
    ]) {
      expect(APP_BADGES[appId], `missing curated badge for ${appId}`).toBeDefined()
    }
  })

  it('generates deterministic badges for unknown apps', () => {
    const a = badgeForAppId('com.example.widget')
    const b = badgeForAppId('com.example.widget')
    expect(a).toEqual(b)
    // 生成结果必然落在已定义的冷色色板内，字形必然可渲染。
    expect(BADGE_PALETTES).toContainEqual({ from: a.from, to: a.to })
    expect(BADGE_GLYPHS).toContain(a.glyph)
  })

  it('distributes unknown apps over the palette space (not one-size-fits-all)', () => {
    const keys = new Set(
      Array.from({ length: 40 }, (_, index) => `com.vendor${index}.app${index}`).map(
        (id) => `${badgeForAppId(id).from}->${badgeForAppId(id).to}`,
      ),
    )
    expect(keys.size).toBeGreaterThan(3)
  })

  it('prefers curated badges over generated ones', () => {
    expect(badgeForAppId('com.ageha.files')).toEqual(APP_BADGES['com.ageha.files'])
  })
})

describe('badgeForAppIdWithHue（今日应用世界行着色，§6.4）', () => {
  it('rotates both gradient stops to the world hue while keeping the glyph', () => {
    const base = badgeForAppId('com.ageha.eclosion.edge-oracle')
    const tinted = badgeForAppIdWithHue('com.ageha.eclosion.edge-oracle', 268)
    expect(tinted.glyph).toBe(base.glyph)
    expect(tinted.from).not.toBe(base.from)
    expect(tinted.to).not.toBe(base.to)
    // 输出是合法 hex，且双 stop 均被旋转（明度差保持渐变深度）。
    expect(tinted.from).toMatch(/^#[0-9a-f]{6}$/i)
    expect(tinted.to).toMatch(/^#[0-9a-f]{6}$/i)
    // 确定性：同 hue 恒同结果。
    expect(badgeForAppIdWithHue('com.ageha.eclosion.edge-oracle', 268).from).toBe(tinted.from)
  })

  it('returns the deterministic badge untouched when no hue is given', () => {
    expect(badgeForAppIdWithHue('com.ageha.files', undefined)).toEqual(badgeForAppId('com.ageha.files'))
  })
})
