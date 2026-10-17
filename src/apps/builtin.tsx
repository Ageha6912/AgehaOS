import type { ReactNode } from 'react'

import type { MessageKey } from '@/core/i18n'

import { DynamicPanelApp } from './dynamic-panel/DynamicPanelApp'
import { BrowserApp } from './browser/BrowserApp'
import { FileManagerApp } from './files/FileManagerApp'
import { NotesApp } from './notes/NotesApp'
import { SettingsApp } from './settings/SettingsApp'
import { StoreApp } from './store/StoreApp'
import { CalculatorApp } from './calculator/CalculatorApp'
import { TerminalApp } from './terminal/TerminalApp'
import type { AppHostProps } from './placeholder-app'

export interface AppUiMeta {
  /** Localized display name for the launcher/window title (PRD §41). */
  titleKey: MessageKey
  Component: (props: AppHostProps) => ReactNode
}

/**
 * UI-side metadata for built-in apps, keyed by manifest id. Apps installed
 * without an entry here fall back to their manifest name. Visual identity
 * (badge icons) lives in ./app-icon — every id here must ship a badge there.
 */
export const APP_UI_META: Record<string, AppUiMeta> = {
  'com.ageha.notes': { titleKey: 'app.notes.title', Component: NotesApp },
  'com.ageha.files': { titleKey: 'app.files.title', Component: FileManagerApp },
  'com.ageha.settings': { titleKey: 'app.settings.title', Component: SettingsApp },
  'com.ageha.store': { titleKey: 'app.store.title', Component: StoreApp },
  'com.ageha.calculator': { titleKey: 'app.calculator.title', Component: CalculatorApp },
  'com.ageha.dynamic.panel': { titleKey: 'app.dynamicPanel.title', Component: DynamicPanelApp },
  'com.ageha.terminal': { titleKey: 'app.terminal.title', Component: TerminalApp },
  'com.ageha.browser': { titleKey: 'app.browser.title', Component: BrowserApp },
}

export function componentFor(appId: string): AppUiMeta | null {
  return APP_UI_META[appId] ?? null
}
