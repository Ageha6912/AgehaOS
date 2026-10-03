import { describe, expect, it } from 'vitest'

import {
  ECLOSION_WORLD_ICON_WHITELIST,
  ECLOSION_WORLD_PALETTE_IDS,
  eclosionAccentHuePassesGate,
  resolveEclosionAccentHue,
  validateEclosionWorld,
  type EclosionWorldApp,
} from './world'

/**
 * 今日世界载荷校验（客户端半场，AI-GENERATED-APPS-DESIGN §6.2）。
 * 正反例字面量与 server/test/eclosion-world.test.ts 共用同批口径（该测试会
 * 动态引入本模块比对两侧判定一致）。
 */

interface AppFixture {
  slug: string
  name: string
  icon: string
  hue: number
  tagline: string
  category: string
  hint?: string
  window?: { width: number; height: number }
}

export function validApp(overrides: Partial<AppFixture> = {}): AppFixture {
  return {
    slug: 'edge-oracle',
    name: '边缘神谕',
    icon: 'Sparkle',
    hue: 268,
    tagline: '在你的浏览器里预言下一行代码',
    category: 'tools',
    ...overrides,
  }
}

export function appSeries(count: number, corrupt?: (index: number) => Partial<AppFixture>): AppFixture[] {
  return Array.from({ length: count }, (_, index) =>
    validApp({
      slug: `app-${String(index + 1).padStart(2, '0')}`,
      name: `应用零${index}`,
      ...((corrupt?.(index) ?? {}) as Partial<AppFixture>),
    }),
  )
}

export const VALID_THEME = {
  type: 'theme',
  headline: '本地智能体与边缘推理的清晨',
  paletteId: 'nebula-violet',
  accentHue: 212,
  wallpaper: { engine: 'landscape', paletteId: 'nebula-violet', mood: 'calm' },
}

function publicPayload(apps: AppFixture[], theme: Record<string, unknown> = VALID_THEME) {
  const themeFields: Record<string, unknown> = { ...theme }
  delete themeFields.type
  return {
    worldDate: '2026-10-03',
    generatedAt: '2026-10-03T00:00:00.000Z',
    degraded: false,
    signalCount: 3,
    signals: { titles: ['信号甲', '信号乙', '信号丙'], sourceName: 'GitHub Trending', sourceUrl: 'https://example.invalid/feed' },
    theme: themeFields,
    apps: apps.map((app) => ({ ...app, hint: undefined })),
  }
}

describe('validateEclosionWorld (§6.2 行级口径)', () => {
  it('accepts a well-formed payload and normalizes it', () => {
    const world = validateEclosionWorld(publicPayload(appSeries(8)))
    expect(world).not.toBeNull()
    expect(world?.worldDate).toBe('2026-10-03')
    expect(world?.degraded).toBe(false)
    expect(world?.signalCount).toBe(3)
    expect(world?.signals.sourceName).toBe('GitHub Trending')
    expect(world?.theme.headline).toBe('本地智能体与边缘推理的清晨')
    expect(world?.theme.paletteId).toBe('nebula-violet')
    expect(world?.theme.accentHue).toBe(212)
    expect(world?.theme.wallpaper).toEqual({
      engine: 'landscape',
      paletteId: 'nebula-violet',
      mood: 'calm',
    })
    expect(world?.apps.map((app) => app.slug)).toEqual([
      'app-01', 'app-02', 'app-03', 'app-04', 'app-05', 'app-06', 'app-07', 'app-08',
    ])
    expect(world?.apps[0]).toMatchObject({
      name: '应用零0',
      icon: 'Sparkle',
      hue: 268,
      category: 'tools',
      window: { width: 720, height: 480 },
    } satisfies Partial<EclosionWorldApp>)
    // hint 字段即使混进来也不透传（ADR 27：hint 只在服务端）。
    expect(JSON.stringify(world)).not.toContain('hint')
  })

  it('drops invalid app rows and keeps the payload valid when 6+ remain', () => {
    const apps = appSeries(7, (index) => {
      if (index === 6) {
        return { slug: 'Bad_Slug', name: '坏行', icon: 'Sparkle', hue: 1, tagline: 'x', category: 'tools' }
      }
      return {}
    })
    const world = validateEclosionWorld(publicPayload(apps))
    expect(world?.apps.map((app) => app.slug)).toEqual([
      'app-01', 'app-02', 'app-03', 'app-04', 'app-05', 'app-06',
    ])
  })

  it.each([
    ['slug 含大写', { slug: 'Edge-Oracle' }],
    ['slug 过短', { slug: 'a' }],
    ['name 超 12 字', { name: '一二三四五六七八九十一二三' }],
    ['name 撞 L0/L1 保留名', { name: '计算器' }],
    ['name 违规词', { name: '赌场助手' }],
    ['icon 不在白名单', { icon: 'NotAnIcon' }],
    ['hue 越界 360', { hue: 360 }],
    ['hue 非整数', { hue: 12.5 }],
    ['tagline 含裸链接（误导）', { tagline: '详见 https://evil.example/x' }],
    ['tagline 超长', { tagline: '好'.repeat(81) }],
    ['category 越界', { category: 'finance' }],
  ])('rejects app row: %s', (_label, corrupt) => {
    const apps = appSeries(7, (index) => (index === 6 ? (corrupt as Partial<AppFixture>) : {}))
    const world = validateEclosionWorld(publicPayload(apps))
    expect(world?.apps.length).toBe(6)
  })

  it('deduplicates slugs within the day', () => {
    const apps = appSeries(7, (index) => (index === 6 ? { slug: 'app-01' } : {}))
    const world = validateEclosionWorld(publicPayload(apps))
    expect(world?.apps.length).toBe(6)
  })

  it('enforces the 6–10 app bounds at the whole-payload level', () => {
    expect(validateEclosionWorld(publicPayload(appSeries(5)))).toBeNull()
    expect(validateEclosionWorld(publicPayload(appSeries(6)))).not.toBeNull()
    expect(validateEclosionWorld(publicPayload(appSeries(10)))).not.toBeNull()
    expect(validateEclosionWorld(publicPayload(appSeries(11)))).toBeNull()
  })

  it.each([
    ['paletteId 不在白名单', { paletteId: 'dusk' }],
    ['paletteId 为山水组', { paletteId: 'shanshui-ink' }],
    ['accentHue 越界', { accentHue: 400 }],
    ['headline 缺失', { headline: undefined }],
    ['headline 含裸链接', { headline: '看这里 https://evil.example' }],
  ])('rejects theme: %s', (_label, corrupt) => {
    const world = validateEclosionWorld(publicPayload(appSeries(7), { ...VALID_THEME, ...corrupt }))
    expect(world).toBeNull()
  })

  it('rejects malformed envelopes (worldDate/theme/apps shape)', () => {
    const good = publicPayload(appSeries(7))
    expect(validateEclosionWorld(null)).toBeNull()
    expect(validateEclosionWorld({ ...good, worldDate: '2026/10/03' })).toBeNull()
    expect(validateEclosionWorld({ ...good, apps: 'nope' })).toBeNull()
    expect(validateEclosionWorld({ ...good, theme: null })).toBeNull()
  })

  it('clamps out-of-range windows to the 720×480 default', () => {
    const apps = appSeries(7, (index) =>
      index === 6 ? { window: { width: 100, height: 9999 } } : {},
    )
    const world = validateEclosionWorld(publicPayload(apps))
    expect(world?.apps[6].window).toEqual({ width: 720, height: 480 })
  })
})

describe('accentHue quality gate (§6.2/§6.3)', () => {
  it('keeps a passing hue unchanged', () => {
    expect(resolveEclosionAccentHue(212, 'nebula-violet')).toBe(212)
    expect(eclosionAccentHuePassesGate(212)).toBe(true)
  })

  it('falls back to the palette default hue when the gate fails (yellow on light)', () => {
    expect(eclosionAccentHuePassesGate(60)).toBe(false)
    const resolved = resolveEclosionAccentHue(60, 'nebula-violet')
    expect(resolved).not.toBe(60)
    expect(eclosionAccentHuePassesGate(resolved)).toBe(true)
  })

  it('palette whitelist = 24 abstract palettes, shanshui-* excluded', () => {
    expect(ECLOSION_WORLD_PALETTE_IDS).toHaveLength(24)
    expect(ECLOSION_WORLD_PALETTE_IDS.filter((id) => id.startsWith('shanshui-'))).toEqual([])
    expect(ECLOSION_WORLD_PALETTE_IDS).toContain('nebula-violet')
  })

  it('icon whitelist is non-trivial and excludes made-up names', () => {
    expect(ECLOSION_WORLD_ICON_WHITELIST.length).toBeGreaterThan(50)
    expect(ECLOSION_WORLD_ICON_WHITELIST).toContain('Sparkle')
    expect(ECLOSION_WORLD_ICON_WHITELIST).not.toContain('NotAnIcon')
  })
})
