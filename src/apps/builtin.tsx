import type { ReactNode } from 'react'

import { Calculator, FolderOpen, GearSix, Newspaper, NotePencil, Storefront } from '@phosphor-icons/react'

import type { MessageKey } from '@/core/i18n'

import { DynamicPanelApp } from './dynamic-panel/DynamicPanelApp'
import { FileManagerApp } from './files/FileManagerApp'
import { NotesApp } from './notes/NotesApp'
import { SettingsApp } from './settings/SettingsApp'
import { StoreApp } from './store/StoreApp'
import { CalculatorApp } from './calculator/CalculatorApp'
import type { AppHostProps } from './placeholder-app'

export interface AppUiMeta {
  /** Localized display name for the launcher/window title (PRD §41). */
  titleKey: MessageKey
  icon: ReactNode
  Component: (props: AppHostProps) => ReactNode
}

/**
 * UI-side metadata for built-in apps, keyed by manifest id. Apps installed
 * without an entry here fall back to their manifest name and a generic icon.
 */
export const APP_UI_META: Record<string, AppUiMeta> = {
  'com.ageha.notes': {
    titleKey: 'app.notes.title',
    icon: <NotePencil size={16} weight="regular" />,
    Component: NotesApp,
  },
  'com.ageha.files': {
    titleKey: 'app.files.title',
    icon: <FolderOpen size={16} weight="regular" />,
    Component: FileManagerApp,
  },
  'com.ageha.settings': {
    titleKey: 'app.settings.title',
    icon: <GearSix size={16} weight="regular" />,
    Component: SettingsApp,
  },
  'com.ageha.store': {
    titleKey: 'app.store.title',
    icon: <Storefront size={16} weight="regular" />,
    Component: StoreApp,
  },
  'com.ageha.calculator': {
    titleKey: 'app.calculator.title',
    icon: <Calculator size={16} weight="regular" />,
    Component: CalculatorApp,
  },
  'com.ageha.dynamic.panel': {
    titleKey: 'app.dynamicPanel.title',
    icon: <Newspaper size={16} weight="regular" />,
    Component: DynamicPanelApp,
  },
}

export function componentFor(appId: string): AppUiMeta | null {
  return APP_UI_META[appId] ?? null
}
