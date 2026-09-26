import { create } from 'zustand'

import { getLocale, setLocale } from '@/core/i18n'
import type { Locale } from '@/core/i18n'

export type ThemePreference = 'light' | 'dark' | 'system'
export type FontSize = 'small' | 'medium' | 'large'

export const FONT_SIZE_PX: Record<FontSize, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
}

const STORAGE_KEY = 'agehaos.settings.v1'
// 设计基线 2026-09 起为浅色（docs/DESIGN.md）；存量用户已保存偏好不受影响。
const DEFAULT_THEME: ThemePreference = 'light'
const DEFAULT_FONT_SIZE: FontSize = 'medium'

interface PersistedSettings {
  theme?: string
  fontSize?: string
  locale?: string
}

interface SettingsState {
  theme: ThemePreference
  fontSize: FontSize
  setTheme: (theme: ThemePreference) => void
  setFontSize: (fontSize: FontSize) => void
  setLocale: (locale: Locale) => void
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', resolveTheme(preference) === 'dark')
}

function applyFontSize(fontSize: FontSize): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.fontSize = FONT_SIZE_PX[fontSize]
}

function loadPersisted(): PersistedSettings {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedSettings) : {}
  } catch {
    return {}
  }
}

function persist(state: Pick<SettingsState, 'theme' | 'fontSize'>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: PersistedSettings = {
      theme: state.theme,
      fontSize: state.fontSize,
      locale: getLocale(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota or privacy mode: settings stay in memory */
  }
}

const persisted = loadPersisted()
const isTheme = (value: string | undefined): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system'
const isFontSize = (value: string | undefined): value is FontSize =>
  value === 'small' || value === 'medium' || value === 'large'
const isLocale = (value: string | undefined): value is Locale => value === 'zh-CN' || value === 'en'

const initialTheme: ThemePreference = isTheme(persisted.theme) ? persisted.theme : DEFAULT_THEME
const initialFontSize: FontSize = isFontSize(persisted.fontSize)
  ? persisted.fontSize
  : DEFAULT_FONT_SIZE

if (isLocale(persisted.locale)) setLocale(persisted.locale)
applyTheme(initialTheme)
applyFontSize(initialFontSize)

export const useSettingsStore = create<SettingsState>()((set) => ({
  theme: initialTheme,
  fontSize: initialFontSize,

  setTheme: (theme) => {
    applyTheme(theme)
    persist({ theme, fontSize: useSettingsStore.getState().fontSize })
    set({ theme })
  },

  setFontSize: (fontSize) => {
    applyFontSize(fontSize)
    persist({ theme: useSettingsStore.getState().theme, fontSize })
    set({ fontSize })
  },

  setLocale: (locale) => {
    setLocale(locale)
    persist({
      theme: useSettingsStore.getState().theme,
      fontSize: useSettingsStore.getState().fontSize,
    })
  },
}))

// Follow OS theme changes while in "system" mode.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (useSettingsStore.getState().theme === 'system') applyTheme('system')
  }
  media.addEventListener?.('change', onChange)
}

/** Restores boot defaults; used between tests. */
export function resetSettingsStore(): void {
  applyTheme(DEFAULT_THEME)
  applyFontSize(DEFAULT_FONT_SIZE)
  useSettingsStore.setState({ theme: DEFAULT_THEME, fontSize: DEFAULT_FONT_SIZE })
}
