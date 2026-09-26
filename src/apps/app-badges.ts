import type { ComponentType } from 'react'
import {
  Calculator,
  FolderOpen,
  GearSix,
  Newspaper,
  NotePencil,
  Package,
  Storefront,
  TerminalWindow,
} from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'

/**
 * 应用徽章配置（docs/DESIGN.md §6）：每内置应用一枚冷色系双色渐变
 * 圆角徽章 + 白色填充字形；几何统一，色相在蓝白基调邻近域取值。
 * 未注册应用回落到石墨蓝通用徽章（Package 字形）。
 */
export interface AppBadge {
  from: string
  to: string
  glyph: ComponentType<IconProps>
}

export const FALLBACK_BADGE: AppBadge = { from: '#6b7a94', to: '#46536b', glyph: Package }

export const APP_BADGES: Record<string, AppBadge> = {
  'com.ageha.files': { from: '#3b6cf6', to: '#1d43b8', glyph: FolderOpen },
  'com.ageha.notes': { from: '#8b6cf2', to: '#5a3ed0', glyph: NotePencil },
  'com.ageha.settings': { from: '#64748b', to: '#3f4c63', glyph: GearSix },
  'com.ageha.store': { from: '#22a7f0', to: '#0369a1', glyph: Storefront },
  'com.ageha.calculator': { from: '#6d75f8', to: '#4338ca', glyph: Calculator },
  'com.ageha.dynamic.panel': { from: '#1fb8a6', to: '#0f766e', glyph: Newspaper },
  'com.ageha.terminal': { from: '#3a4761', to: '#1c2434', glyph: TerminalWindow },
}
