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
]

const PALETTE_BY_ID = new Map(PALETTES.map((p) => [p.id, p]))

export function paletteById(id: string): Palette | undefined {
  return PALETTE_BY_ID.get(id)
}

/**
 * 风格 × 调色板兼容约束（§4.3 pickCompatiblePalette 的可行域）：
 * 粒子星云只允许深色底，山水剪影只允许低饱和，其余不限。
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
}

export function isCompatible(style: WallpaperStyle, palette: Palette): boolean {
  const c = STYLE_FAMILY_CONSTRAINTS[style]
  if (c.lightness && palette.family.lightness !== c.lightness) return false
  if (c.saturation && palette.family.saturation !== c.saturation) return false
  return true
}

export function compatiblePalettes(style: WallpaperStyle): Palette[] {
  return PALETTES.filter((p) => isCompatible(style, p))
}
