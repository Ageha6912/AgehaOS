import type { ComponentType } from 'react'
import {
  AppWindow,
  BookOpen,
  Bomb,
  Brain,
  Calculator,
  Camera,
  ChatCircleText,
  Clock,
  CloudArrowUp,
  FolderOpen,
  GameController,
  GearSix,
  Globe,
  GridFour,
  Hash,
  Joystick,
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

/** 精选徽章：内置 7 应用 + 羽化 L1 三件套 + 商店样本 5 应用。 */
export const APP_BADGES: Record<string, AppBadge> = {
  'com.ageha.files': { from: '#3b6cf6', to: '#1d43b8', glyph: FolderOpen },
  'com.ageha.notes': { from: '#8b6cf2', to: '#5a3ed0', glyph: NotePencil },
  'com.ageha.settings': { from: '#64748b', to: '#3f4c63', glyph: GearSix },
  'com.ageha.store': { from: '#22a7f0', to: '#0369a1', glyph: Storefront },
  'com.ageha.calculator': { from: '#6d75f8', to: '#4338ca', glyph: Calculator },
  'com.ageha.dynamic.panel': { from: '#1fb8a6', to: '#0f766e', glyph: Newspaper },
  'com.ageha.terminal': { from: '#3a4761', to: '#1c2434', glyph: TerminalWindow },
  // 浏览器（档 C：窗口内浏览 + 新标签兜底）：地球仪字形 + 明亮天蓝族。
  'com.ageha.browser': { from: '#38bdf8', to: '#1d4ed8', glyph: Globe },
  // 羽化三件套（AI-GENERATED-APPS-DESIGN §5.2）：字形与原生对应应用一致
  // （同一应用、另一形态），配色换冷色青蓝族以示「AI 生成版」。
  'com.ageha.eclosion.calculator': { from: '#38bdf8', to: '#1d4ed8', glyph: Calculator },
  'com.ageha.eclosion.notes': { from: '#22d3ee', to: '#0e7490', glyph: NotePencil },
  'com.ageha.eclosion.clock': { from: '#818cf8', to: '#312e81', glyph: Clock },
  'com.ageha.samples.clock': { from: '#22d3ee', to: '#0e7490', glyph: Clock },
  'com.ageha.samples.sketch': { from: '#c084fc', to: '#7e22ce', glyph: PaintBrush },
  'com.ageha.samples.sticky': { from: '#818cf8', to: '#3730a3', glyph: NotePencil },
  'com.ageha.samples.fs-note': { from: '#38bdf8', to: '#1d4ed8', glyph: CloudArrowUp },
  'com.ageha.samples.counter': { from: '#60a5fa', to: '#2563eb', glyph: Hash },
  'com.ageha.games.snake': { from: '#34d399', to: '#047857', glyph: Joystick },
  'com.ageha.games.2048': { from: '#67e8f9', to: '#155e75', glyph: GridFour },
  'com.ageha.games.memory': { from: '#d8b4fe', to: '#9333ea', glyph: Brain },
  'com.ageha.games.mines': { from: '#94a3b8', to: '#475569', glyph: Bomb },
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const int = Number.parseInt(match[1] as string, 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}

function hueRotateHex(hex: string, hue: number): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return hex
  const { r, g, b } = rgb
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  if (max === min) return hex
  const delta = max - min
  const s = delta / (1 - Math.abs(2 * l - 1))
  return hslToHex(hue, s, l)
}

/**
 * 世界行 hue 着色徽章（AI-GENERATED-APPS-DESIGN §6.4）：沿用确定性徽章体系
 *（字形/明度差保持），只把渐变双 stop 的色相旋转到世界行 hue——不做 AI 生图。
 */
export function badgeForAppIdWithHue(appId: string, hue: number | undefined): AppBadge {
  const badge = badgeForAppId(appId)
  if (hue === undefined) return badge
  return {
    from: hueRotateHex(badge.from, hue),
    to: hueRotateHex(badge.to, hue),
    glyph: badge.glyph,
  }
}
