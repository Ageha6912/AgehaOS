import { buildWallpaperPlan, COMPOSITIONS } from './templates'
import type { WallpaperPlan } from '../types'

/**
 * 兜底素材（设计文档 §9.1）：
 * - F3 静态渐变：现 Desktop 渐变（Desktop.tsx:6）的 Token 化版本，恒定可用；
 * - F2 内置精选集：按构建打包的 12 张确定性计划（按种子重放渲染），管线选取前先过质量门。
 */

export function staticGradientPlan(theme: 'light' | 'dark'): WallpaperPlan {
  const paletteId = theme === 'dark' ? 'static-gradient-dark' : 'static-gradient-light'
  return {
    seed: `static-gradient|${theme}`,
    generatorVersion: 1,
    templateId: 'static-gradient@1',
    style: 'fluid-gradient',
    paletteId,
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    shapes: [],
    animation: { kind: 'none', flickerPerSec: 0 },
    reason: { signals: ['fallback:static-gradient'], palette: paletteId, motif: 'fluid-gradient' },
    zone: 'fallback',
  }
}

/** L3 渲染用的渐变 stops（dark 取 v0.1 桌面渐变原值；light 取 --ag-bg 家族）。 */
export const STATIC_GRADIENT_STOPS: Record<'light' | 'dark', string[]> = {
  dark: ['#231437', '#151033', '#0b0d14'],
  light: ['#eef0f6', '#e2e6ef', '#d3d9e6'],
}

const LIGHT_CURATED_PALETTES = new Set([
  'morning-mist',
  'porcelain',
  'linen-sky',
  'pale-sand',
  'citrus-dawn',
  'seaglass',
])

/** F2 精选组合（风格 × 主题匹配的调色板，全部为人工审校组合；前 6 张深色、后 6 张浅色）。 */
const CURATED_COMBOS: Array<{ style: WallpaperPlan['style']; paletteId: string }> = [
  { style: 'fluid-gradient', paletteId: 'midnight-ink' },
  { style: 'geometric', paletteId: 'slate-night' },
  { style: 'particle-nebula', paletteId: 'nebula-violet' },
  { style: 'mountain-silhouette', paletteId: 'charcoal-mist' },
  { style: 'grid-wavefield', paletteId: 'deep-ocean' },
  { style: 'fluid-gradient', paletteId: 'aurora-borealis' },
  { style: 'fluid-gradient', paletteId: 'morning-mist' },
  { style: 'geometric', paletteId: 'porcelain' },
  { style: 'grid-wavefield', paletteId: 'linen-sky' },
  { style: 'mountain-silhouette', paletteId: 'pale-sand' },
  { style: 'fluid-gradient', paletteId: 'citrus-dawn' },
  { style: 'geometric', paletteId: 'seaglass' },
]

/** 12 张精选计划：固定种子，逐项确定性（同一张恒定同一结果）。 */
export function curatedPlans(): WallpaperPlan[] {
  return CURATED_COMBOS.map((combo, index) => {
    const seed = `curated-${String(index + 1).padStart(2, '0')}`
    return buildWallpaperPlan({
      seed,
      style: combo.style,
      paletteId: combo.paletteId,
      compositionId: COMPOSITIONS[index % COMPOSITIONS.length].id,
      density: [0.1, 0.3, 0.5, 0.7, 0.9][index % 5],
      zone: 'fallback',
      reason: {
        signals: [
          'fallback:curated',
          LIGHT_CURATED_PALETTES.has(combo.paletteId) ? 'theme:light' : 'theme:dark',
        ],
        palette: combo.paletteId,
        motif: combo.style,
      },
    })
  })
}
