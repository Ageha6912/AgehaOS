import type { Palette, WallpaperStyle } from '../types'

/**
 * 24 组策展调色板（设计文档 §4.3）。全部人工审校，「随机」永远落在该空间内（铁律 2）。
 * family = 明暗 × 饱和，支撑 §10.2 冷启动中性先验（深色低饱和 40% / 浅色低饱和 25% /
 * 深色高饱和 20% / 浅色高饱和 15%）。
 */
export const PALETTES: Palette[] = [
  // 深色低饱和（6）
  { id: 'midnight-ink', family: { lightness: 'dark', saturation: 'low' }, stops: ['#0b0d14', '#151823', '#1d2133'], accent: '#3f4a6b' },
  { id: 'deep-ocean', family: { lightness: 'dark', saturation: 'low' }, stops: ['#0a1118', '#12212e', '#1a2f3f'], accent: '#41607a' },
  { id: 'charcoal-mist', family: { lightness: 'dark', saturation: 'low' }, stops: ['#141416', '#1e1f24', '#2a2c33'], accent: '#5a5e6b' },
  { id: 'dusk-forest', family: { lightness: 'dark', saturation: 'low' }, stops: ['#0d1210', '#15201a', '#1f2e25'], accent: '#47604f' },
  { id: 'slate-night', family: { lightness: 'dark', saturation: 'low' }, stops: ['#101319', '#181d26', '#222835'], accent: '#4d5871' },
  { id: 'obsidian', family: { lightness: 'dark', saturation: 'low' }, stops: ['#0a0a0c', '#131318', '#1d1d24'], accent: '#444452' },

  // 深色高饱和（6）
  { id: 'aurora-borealis', family: { lightness: 'dark', saturation: 'high' }, stops: ['#071018', '#0b2333', '#134a44'], accent: '#2dd4a7' },
  { id: 'nebula-violet', family: { lightness: 'dark', saturation: 'high' }, stops: ['#0d0716', '#1d0f38', '#3b1d6e'], accent: '#8b7cf0' },
  { id: 'ember-sunset', family: { lightness: 'dark', saturation: 'high' }, stops: ['#160709', '#3d0f14', '#7a1f22'], accent: '#f2657a' },
  { id: 'tropical-night', family: { lightness: 'dark', saturation: 'high' }, stops: ['#04121a', '#093a44', '#0e6e6b'], accent: '#22d3ee' },
  { id: 'neon-tide', family: { lightness: 'dark', saturation: 'high' }, stops: ['#0a0618', '#1a0f42', '#43178f'], accent: '#c084fc' },
  { id: 'cosmos-burst', family: { lightness: 'dark', saturation: 'high' }, stops: ['#0b0714', '#241052', '#5b21a8'], accent: '#a78bfa' },

  // 浅色低饱和（6）
  { id: 'morning-mist', family: { lightness: 'light', saturation: 'low' }, stops: ['#eef0f6', '#e2e6ef', '#d3d9e6'], accent: '#8b93ad' },
  { id: 'linen-sky', family: { lightness: 'light', saturation: 'low' }, stops: ['#f2f4f8', '#e6ebf3', '#d8e0ec'], accent: '#93a3bd' },
  { id: 'pale-sand', family: { lightness: 'light', saturation: 'low' }, stops: ['#f6f3ec', '#ece6d9', '#dfd7c4'], accent: '#a89a7c' },
  { id: 'cloud-dawn', family: { lightness: 'light', saturation: 'low' }, stops: ['#f3f1f5', '#e9e4ee', '#dcd5e6'], accent: '#a294b8' },
  { id: 'seaglass', family: { lightness: 'light', saturation: 'low' }, stops: ['#ecf3f1', '#dcebe7', '#c9e1db'], accent: '#7fa89e' },
  { id: 'porcelain', family: { lightness: 'light', saturation: 'low' }, stops: ['#f1f2f4', '#e5e7eb', '#d8dbe2'], accent: '#98a0b3' },

  // 浅色高饱和（6）
  { id: 'citrus-dawn', family: { lightness: 'light', saturation: 'high' }, stops: ['#fff7e0', '#ffe6ad', '#ffd071'], accent: '#f59e0b' },
  { id: 'coral-reef', family: { lightness: 'light', saturation: 'high' }, stops: ['#ffeef0', '#ffd4da', '#ffb3c0'], accent: '#f43f5e' },
  { id: 'meadow-bloom', family: { lightness: 'light', saturation: 'high' }, stops: ['#eefbe8', '#d7f5c8', '#b9e9a3'], accent: '#22c55e' },
  { id: 'sunset-pop', family: { lightness: 'light', saturation: 'high' }, stops: ['#fff1e0', '#ffd9b8', '#ffb98a'], accent: '#fb7185' },
  { id: 'lagoon-vivid', family: { lightness: 'light', saturation: 'high' }, stops: ['#e6fbfa', '#c2f2ef', '#93e6e1'], accent: '#06b6d4' },
  { id: 'blossom-festival', family: { lightness: 'light', saturation: 'high' }, stops: ['#fdf0ff', '#f8d7fb', '#f2b8f5'], accent: '#d946ef' },

  // —— Phase A.5 山水调色板（6 组，人工审校）：stops = 天空；ridge = 由远及近 4 层色阶 ——
  // 晨雾（浅 · 低饱和）
  { id: 'shanshui-dawn', family: { lightness: 'light', saturation: 'low' }, stops: ['#dfe7ee', '#e9e3da', '#f2e8d8'], accent: '#c9a26b', sun: '#f4d9a0', ridge: ['#b9c3cc', '#96a3ad', '#71808c', '#4f5d68'], mist: '#f4efe6' },
  // 晴岚湖色（浅 · 高饱和）
  { id: 'shanshui-day', family: { lightness: 'light', saturation: 'high' }, stops: ['#bfd9ec', '#a9c9e4', '#8fb6d8'], accent: '#4a7fae', sun: '#ffe9b0', ridge: ['#9db8cf', '#6f94b3', '#4a7291', '#2f5570'], water: '#7fa8c9' },
  // 青绿山水（浅 · 高饱和，石青石绿）
  { id: 'shanshui-green', family: { lightness: 'light', saturation: 'high' }, stops: ['#cfe4de', '#b7d6cc', '#9cc4b6'], accent: '#2f7d6d', sun: '#f2e2b8', ridge: ['#8fb8a8', '#5f9a85', '#3d7a64', '#285c49'], water: '#7fb8a8' },
  // 水墨夜山（深 · 低饱和）
  { id: 'shanshui-ink', family: { lightness: 'dark', saturation: 'low' }, stops: ['#1d2126', '#262b31', '#30363d'], accent: '#9aa4ad', sun: '#e8e6df', ridge: ['#3d434b', '#4c545e', '#5d6771', '#707c86'], mist: '#4a525b', night: true },
  // 暮色（深 · 高饱和）
  { id: 'shanshui-dusk', family: { lightness: 'dark', saturation: 'high' }, stops: ['#241536', '#4a2547', '#8a4152'], accent: '#e8956b', sun: '#f4b26a', ridge: ['#57355a', '#3f2747', '#2b1b36', '#1c1226'], water: '#6e3d55', night: true },
  // 星夜（深 · 低饱和）
  { id: 'shanshui-night', family: { lightness: 'dark', saturation: 'low' }, stops: ['#0b1020', '#101830', '#16213f'], accent: '#8fa8d9', sun: '#dfe6f5', ridge: ['#1c2740', '#232f4c', '#2c3a58', '#364664'], mist: '#28324a', night: true },
]

const PALETTE_BY_ID = new Map(PALETTES.map((p) => [p.id, p]))

export function paletteById(id: string): Palette | undefined {
  return PALETTE_BY_ID.get(id)
}

/**
 * 风格 × 调色板兼容约束（§4.3 pickCompatiblePalette 的可行域）：
 * 粒子星云只允许深色底，山水剪影只允许低饱和，其余不限。
 * Phase A.5：landscape 只采山水调色板（有 ridge 色阶），山水调色板也
 * 不进抽象风格可行域——两族互斥。
 */
const STYLE_FAMILY_CONSTRAINTS: Record<
  WallpaperStyle,
  Partial<Record<'lightness' | 'saturation', 'dark' | 'light' | 'high' | 'low'>>
> = {
  'fluid-gradient': {},
  geometric: {},
  'particle-nebula': { lightness: 'dark' },
  'mountain-silhouette': { saturation: 'low' },
  'grid-wavefield': {},
  landscape: {},
  // gradient-field 自带构图配色（主题在构图上标注），不进旧调色板可行域。
  'gradient-field': {},
}

export function isCompatible(style: WallpaperStyle, palette: Palette): boolean {
  // 山水调色板带 ridge 色阶；抽象风格绝不采它们，landscape 也只采它们。
  if (style === 'landscape') return palette.ridge !== undefined
  if (palette.ridge !== undefined) return false
  const c = STYLE_FAMILY_CONSTRAINTS[style]
  if (c.lightness && palette.family.lightness !== c.lightness) return false
  if (c.saturation && palette.family.saturation !== c.saturation) return false
  return true
}

export function compatiblePalettes(style: WallpaperStyle): Palette[] {
  return PALETTES.filter((p) => isCompatible(style, p))
}
