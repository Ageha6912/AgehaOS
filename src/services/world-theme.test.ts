import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evaluateQuality } from '@/core/dynamic/governance/quality-gate'
import { fieldCompositionById } from '@/core/dynamic/generative/gradient-field'
import { sha256Hex } from '@/core/dynamic/generative/seed'
import { eclosionAccentHex, eclosionAccentHuePassesGate } from '@/core/eclosion/world'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { resetEclosionStore, useEclosionStore } from '@/store/eclosion-store'
import type { EclosionWorldSummary } from '@/store/eclosion-store'

import {
  applyReplayTheme,
  applyWorldAccent,
  buildWorldWallpaperPlan,
  clearWorldAccent,
  isWorldThemeActive,
  resolveWorldFieldId,
  worldAccentVariables,
  worldWallpaperSeed,
} from './world-theme'

const WORLD: Pick<EclosionWorldSummary, 'worldDate' | 'headline' | 'paletteId'> = {
  worldDate: '2026-10-03',
  headline: '本地智能体与边缘推理的清晨',
  paletteId: 'nebula-violet',
}

afterEach(() => {
  clearWorldAccent()
  document.documentElement.className = ''
})

describe('worldWallpaperSeed（seed 派生稳定性，§6.3）', () => {
  it('is deterministic for the same (worldDate, headline) and derived from sha256', () => {
    const first = worldWallpaperSeed('2026-10-03', '标题甲')
    expect(first).toBe(worldWallpaperSeed('2026-10-03', '标题甲'))
    expect(first).toBe(sha256Hex('2026-10-03|标题甲'))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes with either input (跨日/个人重生成 → 换新壁纸)', () => {
    const base = worldWallpaperSeed('2026-10-03', '标题甲')
    expect(worldWallpaperSeed('2026-10-04', '标题甲')).not.toBe(base)
    expect(worldWallpaperSeed('2026-10-03', '标题乙')).not.toBe(base)
  })
})

describe('resolveWorldFieldId（世界 paletteId → gradient-field 构图）', () => {
  it('picks the composition whose hue is nearest the world palette accent, per theme', () => {
    // nebula-violet 的 accent #8b7cf0 ≈ 247°：暗池 violet-night(252°)、亮池 violet-mist(262°)。
    expect(resolveWorldFieldId('dark', 'nebula-violet')).toBe('violet-night')
    expect(resolveWorldFieldId('light', 'nebula-violet')).toBe('violet-mist')
    // 主题匹配铁律：暗主题绝不下发亮构图。
    expect(fieldCompositionById(resolveWorldFieldId('dark', 'nebula-violet'))?.theme).toBe('dark')
  })

  it('is deterministic and never leaves the theme pool', () => {
    for (const theme of ['light', 'dark'] as const) {
      const first = resolveWorldFieldId(theme, 'coral-reef')
      for (let i = 0; i < 5; i++) expect(resolveWorldFieldId(theme, 'coral-reef')).toBe(first)
      expect(fieldCompositionById(first)?.theme).toBe(theme)
    }
  })

  it('falls back deterministically for an unknown palette (纵深防御，校验层已挡)', () => {
    // 未知 paletteId → 目标色相回落 220°：恰为两池池首（dawn-white/night-veil）。
    expect(resolveWorldFieldId('light', 'not-a-palette')).toBe('dawn-white')
    expect(resolveWorldFieldId('dark', 'not-a-palette')).toBe('night-veil')
    expect(fieldCompositionById(resolveWorldFieldId('dark', 'not-a-palette'))?.theme).toBe('dark')
  })
})

describe('buildWorldWallpaperPlan（照常过质量门）', () => {
  it('produces a quality-gated gradient-field plan seeded by the world', () => {
    for (const theme of ['light', 'dark'] as const) {
      const plan = buildWorldWallpaperPlan(WORLD, theme)
      expect(plan).not.toBeNull()
      expect(plan?.style).toBe('gradient-field')
      expect(plan?.seed).toBe(worldWallpaperSeed(WORLD.worldDate, WORLD.headline))
      expect(plan?.fieldId).toBe(resolveWorldFieldId(theme, WORLD.paletteId))
      // 照常过质量门（§6.3）：双主题都必须合格。
      expect(evaluateQuality({ plan: plan!, snapshot: { theme } }).passed).toBe(true)
      // 透明性：生成理由带世界维度。
      expect(plan?.reason.signals).toContain('world:2026-10-03')
    }
  })
})

describe('worldAccentVariables / applyWorldAccent（brand/accent 族只改色相）', () => {
  it('maps a gated hue onto primary/focus-ring/brand-strong for both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const vars = worldAccentVariables(212, theme)
      expect(vars).not.toBeNull()
      expect(vars?.['--ag-primary']).toBe(eclosionAccentHex(212, theme))
      expect(vars?.['--ag-focus-ring']).toBe(vars?.['--ag-primary'])
    }
  })

  it('applies inline tokens on documentElement and clears them again', () => {
    document.documentElement.className = 'dark'
    expect(applyWorldAccent(212, 'dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).toBe(
      eclosionAccentHex(212, 'dark'),
    )

    clearWorldAccent()
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--ag-brand-strong')).toBe('')
  })

  it('refuses hues that fail the dual-theme contrast gate (回落已在校验层完成)', () => {
    // 黄相（60°）在浅色面上对比度不足：校验层已回落，这里纵深防御不落 inline。
    expect(eclosionAccentHuePassesGate(60)).toBe(false)
    expect(worldAccentVariables(60, 'light')).toBeNull()
    expect(applyWorldAccent(60, 'light')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).toBe('')
  })
})

describe('isWorldThemeActive（动态桌面自动换新护栏）', () => {
  it('only suppresses renewal while the world of *today* is active', () => {
    const base = { enabled: true, themeFollow: true, worldDate: '2026-10-03' }
    expect(isWorldThemeActive({ ...base, today: '2026-10-03' })).toBe(true)
    // 跨日未换新 / 开关关 / 跟随关：护栏不生效，续期照常。
    expect(isWorldThemeActive({ ...base, today: '2026-10-04' })).toBe(false)
    expect(isWorldThemeActive({ ...base, enabled: false, today: '2026-10-03' })).toBe(false)
    expect(isWorldThemeActive({ ...base, themeFollow: false, today: '2026-10-03' })).toBe(false)
    expect(isWorldThemeActive({ enabled: true, themeFollow: true, worldDate: null, today: '2026-10-03' })).toBe(false)
  })
})

// ── 蝶谱回放（§8/P4：只恢复主题与壁纸，不恢复应用、不写今日蝶谱） ───────────

describe('applyReplayTheme（蝶谱「回到那天的主题」）', () => {
  const REPLAY = {
    worldDate: '2026-10-01',
    headline: '那日的世界标题',
    paletteId: 'nebula-violet',
    accentHue: 212,
  }

  beforeEach(() => {
    localStorage.clear()
    resetDynamicDesktopStore()
    resetEclosionStore()
    document.documentElement.className = ''
  })

  afterEach(() => {
    clearWorldAccent()
    resetDynamicDesktopStore()
    resetEclosionStore()
    document.documentElement.className = ''
  })

  it('applies the replay accent and wallpaper while leaving apps and the replay store untouched', () => {
    // 动态桌面开启（无固定）：壁纸计划应换为那日种子驱动的那一张。
    useDynamicDesktopStore.setState({
      prefs: { ...useDynamicDesktopStore.getState().prefs, enabled: true },
    })
    // 当日世界与应用注册面在场：回放不得触碰（只恢复主题与壁纸）。
    useEclosionStore.setState({
      world: {
        worldDate: '2026-10-03',
        headline: '今日世界',
        paletteId: 'coral-reef',
        accentHue: 20,
        degraded: false,
        signalCount: 1,
        signals: { titles: ['今日信号'], sourceName: 'x', sourceUrl: '' },
        apps: [
          {
            slug: 'app-01',
            name: '今日应用',
            hue: 210,
            tagline: 't',
            category: 'tools',
            window: { width: 720, height: 480 },
          },
        ],
      },
      keptAppIds: ['com.ageha.eclosion.app-01'],
    })
    const todayPlanSeedBefore = useDynamicDesktopStore.getState().currentPlan?.seed

    expect(applyReplayTheme(REPLAY)).toBe(true)

    // 主题：accent Token 换为那日色相。
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).toBe(
      eclosionAccentHex(212, 'light'),
    )
    // 壁纸：seed = hash(那日 worldDate+headline)，非今日种子。
    const plan = useDynamicDesktopStore.getState().currentPlan
    expect(plan).not.toBeNull()
    expect(plan?.seed).toBe(worldWallpaperSeed('2026-10-01', '那日的世界标题'))
    expect(plan?.seed).not.toBe(todayPlanSeedBefore)
    // 应用与今日世界不受影响（§8：不恢复应用）。
    expect(useEclosionStore.getState().world?.worldDate).toBe('2026-10-03')
    expect(useEclosionStore.getState().keptAppIds).toEqual(['com.ageha.eclosion.app-01'])
  })

  it('keeps the accent but skips the wallpaper when the desktop is disabled or pinned (铁律 1)', () => {
    useDynamicDesktopStore.setState({ prefs: { ...useDynamicDesktopStore.getState().prefs, enabled: false } })
    expect(applyReplayTheme(REPLAY)).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).toBe(
      eclosionAccentHex(212, 'light'),
    )
    expect(useDynamicDesktopStore.getState().currentPlan).toBeNull()
  })
})
