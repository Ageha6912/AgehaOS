import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLocaleStore } from '@/core/i18n'

import { FONT_SIZE_PX, resetSettingsStore, useSettingsStore } from './settings-store'

function htmlClasses(): DOMTokenList {
  return document.documentElement.classList
}

beforeEach(() => {
  localStorage.clear()
  resetSettingsStore()
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('settings-store theme', () => {
  it('defaults to light (§32 参考图明亮基线，docs/DESIGN.md)', () => {
    expect(useSettingsStore.getState().theme).toBe('light')
    expect(htmlClasses().contains('dark')).toBe(false)
  })

  it('keeps a persisted legacy dark preference on first load', async () => {
    localStorage.setItem('agehaos.settings.v1', JSON.stringify({ theme: 'dark' }))
    vi.resetModules()
    const { useSettingsStore: freshStore } = await import('./settings-store')

    expect(freshStore.getState().theme).toBe('dark')
    expect(htmlClasses().contains('dark')).toBe(true)
  })

  it('applies and removes the dark class on light/dark switches', () => {
    useSettingsStore.getState().setTheme('dark')
    expect(htmlClasses().contains('dark')).toBe(true)

    useSettingsStore.getState().setTheme('light')
    expect(htmlClasses().contains('dark')).toBe(false)
  })

  it('resolves system preference through matchMedia', () => {
    const media = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() })
    vi.stubGlobal('matchMedia', media)

    useSettingsStore.getState().setTheme('system')
    expect(useSettingsStore.getState().theme).toBe('system')
    expect(htmlClasses().contains('dark')).toBe(true)

    vi.unstubAllGlobals()
  })

  it('persists settings to localStorage', () => {
    useSettingsStore.getState().setTheme('light')
    useSettingsStore.getState().setFontSize('large')

    const raw = JSON.parse(localStorage.getItem('agehaos.settings.v1')!)
    expect(raw.theme).toBe('light')
    expect(raw.fontSize).toBe('large')
  })
})

describe('settings-store font size', () => {
  it('applies the root font size', () => {
    useSettingsStore.getState().setFontSize('large')

    expect(document.documentElement.style.fontSize).toBe(FONT_SIZE_PX.large)
  })
})

describe('settings-store locale', () => {
  it('syncs the i18n locale and persists it', () => {
    useSettingsStore.getState().setLocale('en')

    expect(useLocaleStore.getState().locale).toBe('en')
    const raw = JSON.parse(localStorage.getItem('agehaos.settings.v1')!)
    expect(raw.locale).toBe('en')
  })
})
