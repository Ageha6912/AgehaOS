import type { ReactNode } from 'react'

import type { MessageKey } from '@/core/i18n'

import { MissingApp, PlaceholderApp, type AppHostProps } from './placeholder-app'

export interface RegisteredApp {
  appId: string
  titleKey: MessageKey
  icon: string
  width?: number
  height?: number
  Component: (props: AppHostProps) => ReactNode
}

/**
 * Built-in system app catalog (PRD §26). The App Registry with manifests
 * and permissions (PRD §9) replaces this in the Runtime milestone.
 */
export const BUILTIN_APPS: RegisteredApp[] = [
  {
    appId: 'notes',
    titleKey: 'app.notes.title',
    icon: '📝',
    width: 720,
    height: 480,
    Component: PlaceholderApp,
  },
  {
    appId: 'files',
    titleKey: 'app.files.title',
    icon: '📁',
    width: 880,
    height: 560,
    Component: PlaceholderApp,
  },
  {
    appId: 'settings',
    titleKey: 'app.settings.title',
    icon: '⚙️',
    width: 840,
    height: 560,
    Component: PlaceholderApp,
  },
]

export function getApp(appId: string): RegisteredApp | null {
  return BUILTIN_APPS.find((app) => app.appId === appId) ?? null
}

export { MissingApp, PlaceholderApp }
