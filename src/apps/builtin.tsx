import type { ReactNode } from 'react'

import { FolderOpen, GearSix, NotePencil } from '@phosphor-icons/react'

import type { MessageKey } from '@/core/i18n'

import { FileManagerApp } from './files/FileManagerApp'
import { NotesApp } from './notes/NotesApp'
import { SettingsApp } from './settings/SettingsApp'
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
}

export function componentFor(appId: string): AppUiMeta | null {
  return APP_UI_META[appId] ?? null
}
