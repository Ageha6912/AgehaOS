import type { ComponentType } from 'react'
import {
  AppWindow,
  BookOpen,
  Calculator,
  Camera,
  ChatCircleText,
  Clock,
  CloudArrowUp,
  FolderOpen,
  GameController,
  GearSix,
  Hash,
  MusicNote,
  Newspaper,
  NotePencil,
  PaintBrush,
  PuzzlePiece,
  Rocket,
  Storefront,
  TerminalWindow,
} from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'

/**
 * 应用徽章配置（docs/DESIGN.md §8）：每应用一枚冷色系双色渐变圆角徽章 +
 * 白色填充字形。三层来源——
 * 1. 精选：内置 7 应用 + 商店样本 5 应用手工配色；
 * 2. 生成：未知应用（用户安装/管理员发布的任何新应用）由 appId 哈希
 *    确定性选取「色板 × 字形」组合——同一应用永远同一徽章，无需人工介入；
 * 色板全部取自蓝白基调的邻近冷色域，保证系统感。
 */
export interface AppBadge {
  from: string
  to: string
  glyph: ComponentType<IconProps>
}

/** 冷色系渐变色板（生成器用；精选徽章从中取色并配字形）。 */
export interface BadgePalette {
  from: string
  to: string
}

/** 冷色系渐变色板（生成器与精选共用语义域）。 */
export const BADGE_PALETTES: readonly BadgePalette[] = [
  { from: '#3b6cf6', to: '#1d43b8' },
  { from: '#8b6cf2', to: '#5a3ed0' },
  { from: '#64748b', to: '#3f4c63' },
  { from: '#22a7f0', to: '#0369a1' },
  { from: '#6d75f8', to: '#4338ca' },
  { from: '#1fb8a6', to: '#0f766e' },
  { from: '#3a4761', to: '#1c2434' },
  { from: '#22d3ee', to: '#0e7490' },
  { from: '#c084fc', to: '#7e22ce' },
  { from: '#818cf8', to: '#3730a3' },
  { from: '#38bdf8', to: '#1d4ed8' },
  { from: '#60a5fa', to: '#2563eb' },
]

/** 生成器字形候选（白色填充，语义中性）。 */
export const BADGE_GLYPHS: readonly ComponentType<IconProps>[] = [
  AppWindow,
  PuzzlePiece,
  Rocket,
  ChatCircleText,
  Camera,
  MusicNote,
  BookOpen,
  GameController,
  Hash,
  NotePencil,
]

/** 精选徽章：内置 7 应用 + 商店样本 5 应用。 */
export const APP_BADGES: Record<string, AppBadge> = {
  'com.ageha.files': { from: '#3b6cf6', to: '#1d43b8', glyph: FolderOpen },
  'com.ageha.notes': { from: '#8b6cf2', to: '#5a3ed0', glyph: NotePencil },
  'com.ageha.settings': { from: '#64748b', to: '#3f4c63', glyph: GearSix },
  'com.ageha.store': { from: '#22a7f0', to: '#0369a1', glyph: Storefront },
  'com.ageha.calculator': { from: '#6d75f8', to: '#4338ca', glyph: Calculator },
  'com.ageha.dynamic.panel': { from: '#1fb8a6', to: '#0f766e', glyph: Newspaper },
  'com.ageha.terminal': { from: '#3a4761', to: '#1c2434', glyph: TerminalWindow },
  'com.ageha.samples.clock': { from: '#22d3ee', to: '#0e7490', glyph: Clock },
  'com.ageha.samples.sketch': { from: '#c084fc', to: '#7e22ce', glyph: PaintBrush },
  'com.ageha.samples.sticky': { from: '#818cf8', to: '#3730a3', glyph: NotePencil },
  'com.ageha.samples.fs-note': { from: '#38bdf8', to: '#1d4ed8', glyph: CloudArrowUp },
  'com.ageha.samples.counter': { from: '#60a5fa', to: '#2563eb', glyph: Hash },
}

/** djb2 变体：同一 appId 永远得到同一散列（跨会话/跨设备稳定）。 */
function hashAppId(appId: string): number {
  let hash = 5381
  for (let index = 0; index < appId.length; index += 1) {
    hash = ((hash << 5) + hash + appId.charCodeAt(index)) | 0
  }
  return hash >>> 0
}

/** appId → 徽章：精选优先，其余确定性生成。 */
export function badgeForAppId(appId: string): AppBadge {
  const curated = APP_BADGES[appId]
  if (curated) return curated
  const hash = hashAppId(appId)
  const palette = BADGE_PALETTES[hash % BADGE_PALETTES.length]
  const glyph = BADGE_GLYPHS[Math.floor(hash / BADGE_PALETTES.length) % BADGE_GLYPHS.length]
  return { ...palette, glyph }
}
