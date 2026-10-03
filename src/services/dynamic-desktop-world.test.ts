import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { utcDayKey } from '@/core/eclosion/world'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetSessionStore } from '@/store/session-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'

import { systemDynamicDesktop } from './dynamic-desktop'
import { worldWallpaperSeed } from './world-theme'

/** 今日世界主题落地（§6.3）：applyWorldTheme、world.ready 接线、续期护栏。 */
const WORLD = {
  worldDate: '2026-10-03',
  headline: '本地智能体与边缘推理的清晨',
  paletteId: 'nebula-violet',
  accentHue: 212,
  degraded: false,
  signalCount: 3,
  signals: { titles: ['信号甲'], sourceName: 'GitHub Trending', sourceUrl: 'https://example.invalid/feed' },
  apps: [
    { slug: 'edge-oracle', name: '边缘神谕', hue: 268, tagline: '一句话', category: 'tools', window: { width: 720, height: 480 } },
  ],
} as const

const fullWorld = { ...WORLD, apps: [...WORLD.apps] }

beforeEach(() => {
  localStorage.clear()
  resetDynamicDesktopStore()
  resetEclosionStore()
  resetSessionStore()
  resetSettingsStore()
  document.documentElement.className = ''
  document.documentElement.style.removeProperty('--ag-primary')
  systemBus.clear()
  vi.spyOn(systemDynamicDesktop, 'applyWorldTheme')
})

afterEach(() => {
  systemDynamicDesktop.stop()
  vi.restoreAllMocks()
  systemBus.clear()
})

describe('systemDynamicDesktop.applyWorldTheme（§6.3 主题落地）', () => {
  it('applies a quality-gated world plan through the existing pipeline and writes history', () => {
    useDynamicDesktopStore.getState().hydrateForUser('u-world')
    useDynamicDesktopStore.getState().setEnabled(true)

    const applied = systemDynamicDesktop.applyWorldTheme(fullWorld)

    expect(applied).toBe(true)
    const state = useDynamicDesktopStore.getState()
    expect(state.currentPlan?.style).toBe('gradient-field')
    expect(state.currentPlan?.seed).toBe(worldWallpaperSeed(WORLD.worldDate, WORLD.headline))
    expect(state.currentPlan?.fieldId).toBe('violet-mist') // jsdom 无 dark class → 浅色主题构图
    expect(state.lastDecisionSource).toBe('llm')
    // 照常写入历史（§6.3）。
    expect(state.history).toHaveLength(1)
    expect(state.history[0]?.plan.reason.signals).toContain('world:2026-10-03')
    // 强调色落到 Token inline（brand/accent 族）。
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).not.toBe('')
  })

  it('keeps the pinned wallpaper (铁律 1 固定即短路) but still applies the accent', () => {
    useDynamicDesktopStore.getState().hydrateForUser('u-world')
    useDynamicDesktopStore.getState().setEnabled(true)
    const pinned = {
      seed: 'pinned-seed',
      generatorVersion: 1,
      templateId: 't',
      style: 'gradient-field' as const,
      paletteId: 'gradient-field',
      compositionId: 'c',
      density: 0.5,
      shapes: [],
      animation: { kind: 'none' as const, flickerPerSec: 0 },
      reason: { signals: [], palette: 'p', motif: 'gradient-field' as const },
      zone: 'fallback' as const,
      fieldId: 'night-veil',
    }
    useDynamicDesktopStore.setState({ prefs: { ...useDynamicDesktopStore.getState().prefs, pinned } })

    const applied = systemDynamicDesktop.applyWorldTheme(fullWorld)

    expect(applied).toBe(false)
    expect(useDynamicDesktopStore.getState().currentPlan).toBeNull() // 不动壁纸
    expect(useDynamicDesktopStore.getState().history).toHaveLength(0)
    expect(document.documentElement.style.getPropertyValue('--ag-primary')).not.toBe('')
  })

  it('skips the wallpaper while dynamic desktop is off (accent unchanged path)', () => {
    useDynamicDesktopStore.getState().hydrateForUser('u-world') // enabled 默认 false
    expect(systemDynamicDesktop.applyWorldTheme(fullWorld)).toBe(false)
    expect(useDynamicDesktopStore.getState().currentPlan).toBeNull()
  })
})

describe('eclosion.world.ready 接线（§3.2/§6.3）', () => {
  it('applies the theme only when eclosion is on AND theme-follow is on', () => {
    systemDynamicDesktop.start()
    seedEclosionForTests('u-world', true)
    useEclosionStore.getState().applyWorld(fullWorld)

    // themeFollow 默认开：事件触发主题应用。
    systemBus.emit('eclosion.world.ready', { worldDate: WORLD.worldDate })
    expect(systemDynamicDesktop.applyWorldTheme).toHaveBeenCalledWith(fullWorld)

    // 关闭「主题跟随今日世界」：不改主题、只保留今日应用。
    vi.mocked(systemDynamicDesktop.applyWorldTheme).mockClear()
    useEclosionStore.getState().setThemeFollow(false)
    systemBus.emit('eclosion.world.ready', { worldDate: WORLD.worldDate })
    expect(systemDynamicDesktop.applyWorldTheme).not.toHaveBeenCalled()
  })

  it('ignores the event when the payload does not match the stored world', () => {
    systemDynamicDesktop.start()
    seedEclosionForTests('u-world', true)
    useEclosionStore.getState().applyWorld(fullWorld)

    systemBus.emit('eclosion.world.ready', { worldDate: '2026-10-04' })
    expect(systemDynamicDesktop.applyWorldTheme).not.toHaveBeenCalled()
  })

  it('re-applies the world theme when the theme class flips (显式偏好与 system 跟随同径)', async () => {
    systemDynamicDesktop.start()
    seedEclosionForTests('u-world', true)
    useEclosionStore.getState().applyWorld(fullWorld)

    act(() => {
      useSettingsStore.getState().setTheme('dark')
    })
    // MutationObserver 回调走微任务：等重派发生。
    await vi.waitFor(() =>
      expect(systemDynamicDesktop.applyWorldTheme).toHaveBeenCalledWith(fullWorld),
    )

    // 主题类回切但「主题跟随」已关：不重派。
    vi.mocked(systemDynamicDesktop.applyWorldTheme).mockClear()
    useEclosionStore.getState().setThemeFollow(false)
    act(() => {
      useSettingsStore.getState().setTheme('light')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(systemDynamicDesktop.applyWorldTheme).not.toHaveBeenCalled()
  })
})

describe('renewalTick 护栏（世界接管期间不自动换新）', () => {
  it('skips timer renewal while today’s world owns the theme, then resumes after logout', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    seedEclosionForTests('u-world', true)
    // 让「今日」世界在场（日界 = UTC）。
    useEclosionStore.getState().applyWorld({ ...fullWorld, worldDate: utcDayKey() })

    systemDynamicDesktop.start()
    const started = vi.fn()
    systemBus.on('desktop.wallpaper.generate-started', started)
    useDynamicDesktopStore.getState().hydrateForUser('u-world')
    useDynamicDesktopStore.getState().setEnabled(true)
    useDynamicDesktopStore.setState({ lastGenerateAt: 0 }) // 换新间隔早已到期

    vi.advanceTimersByTime(35_000) // renewalTick 跑过至少一轮
    expect(started).not.toHaveBeenCalled() // 世界接管：timer 不冲掉当日壁纸

    // 登出 → 世界清空：护栏解除，timer 恢复正常生成。
    useEclosionStore.getState().handleLogout()
    vi.advanceTimersByTime(35_000)
    expect(started).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
