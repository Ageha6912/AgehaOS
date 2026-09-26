import { describe, expect, it } from 'vitest'

import { APP_UI_META } from './builtin'
import { APP_BADGES, BADGE_GLYPHS, BADGE_PALETTES, badgeForAppId } from './app-badges'

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
