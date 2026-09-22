import { mulberry32 } from './seed'
import type { Composition, PlanShape, WallpaperPlan, WallpaperStyle } from '../types'

/** 生成器版本（§4.3：升级递增，旧三元组结果仍可复现）。 */
export const GENERATOR_VERSION = 1

/** 8 种构图（§4.3：焦点吸附三分点）。 */
export const COMPOSITIONS: Composition[] = [
  { id: 'thirds-nw', focus: { x: 1 / 3, y: 1 / 3 }, angle: 135 },
  { id: 'thirds-n', focus: { x: 0.5, y: 1 / 3 }, angle: 160 },
  { id: 'thirds-ne', focus: { x: 2 / 3, y: 1 / 3 }, angle: 225 },
  { id: 'thirds-w', focus: { x: 1 / 3, y: 0.5 }, angle: 110 },
  { id: 'thirds-e', focus: { x: 2 / 3, y: 0.5 }, angle: 70 },
  { id: 'thirds-sw', focus: { x: 1 / 3, y: 2 / 3 }, angle: 45 },
  { id: 'thirds-s', focus: { x: 0.5, y: 2 / 3 }, angle: 20 },
  { id: 'thirds-se', focus: { x: 2 / 3, y: 2 / 3 }, angle: 315 },
]

export function templateIdOf(style: WallpaperStyle): string {
  return `${style}@${GENERATOR_VERSION}`
}

export function styleOfTemplateId(templateId: string): WallpaperStyle | undefined {
  const style = templateId.split('@')[0]
  return isWallpaperStyle(style) ? style : undefined
}

function isWallpaperStyle(value: string): value is WallpaperStyle {
  return (
    value === 'fluid-gradient' ||
    value === 'geometric' ||
    value === 'particle-nebula' ||
    value === 'mountain-silhouette' ||
    value === 'grid-wavefield'
  )
}

/**
 * 由种子确定性生成图元（§4.3：同一 (seed, generatorVersion, templateId) 恒定产出同一结果）。
 * 图元位于单位坐标系，渲染层负责缩放到画布；布局走带抖动的网格，构造上避免大面积重叠。
 */
export function buildShapes(
  style: WallpaperStyle,
  seed: string,
  composition: Composition,
  density: number,
): PlanShape[] {
  const rng = mulberry32(`${seed}|${templateIdOf(style)}`)
  const shapes: PlanShape[] = []

  const pick = (min: number, max: number) => min + rng() * (max - min)

  switch (style) {
    case 'fluid-gradient': {
      const count = Math.round(3 + density * 2)
      for (let i = 0; i < count; i++) {
        const r = pick(0.22, 0.42)
        // 焦点附近的大色块 + 外围漂移块。
        const towardFocus = i === 0
        shapes.push({
          kind: 'circle',
          x: towardFocus ? composition.focus.x : pick(0.1, 0.9),
          y: towardFocus ? composition.focus.y : pick(0.1, 0.9),
          w: r,
          h: r,
        })
      }
      break
    }
    case 'geometric': {
      const count = Math.round(5 + density * 9)
      const cols = 4
      for (let i = 0; i < count; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        shapes.push({
          kind: 'rect',
          x: (col + pick(0.05, 0.25)) / cols,
          y: (row + pick(0.05, 0.25)) / Math.ceil(count / cols),
          w: pick(0.06, 0.14),
          h: pick(0.06, 0.16),
        })
      }
      break
    }
    case 'particle-nebula': {
      const count = Math.round(12 + density * 48)
      for (let i = 0; i < count; i++) {
        const r = pick(0.004, 0.02)
        shapes.push({ kind: 'circle', x: rng(), y: rng(), w: r, h: r })
      }
      break
    }
    case 'mountain-silhouette': {
      // 3–5 层山脊：全宽横带，高度向焦点方向递减（渲染层以折线绘制，图元取包络矩形）。
      const layers = Math.round(3 + density * 2)
      for (let i = 0; i < layers; i++) {
        const top = 0.35 + (i / layers) * 0.6 + pick(-0.04, 0.04)
        shapes.push({ kind: 'rect', x: 0, y: Math.min(top, 0.96), w: 1, h: 1 - Math.min(top, 0.96) })
      }
      break
    }
    case 'grid-wavefield': {
      const cols = Math.round(8 + density * 16)
      const rows = Math.round(5 + density * 7)
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const wave = Math.sin((col / cols) * Math.PI * 2 + composition.angle * (Math.PI / 180))
          if (wave < 0.1) continue
          shapes.push({
            kind: 'rect',
            x: (col + 0.2) / cols,
            y: (row + 0.25 - wave * 0.12) / rows,
            w: 0.4 / cols,
            h: 0.35 / rows,
          })
        }
      }
      break
    }
  }
  return shapes
}

/** 组装生成计划（决策层选定参数后调用；图元由种子确定性派生）。 */
export function buildWallpaperPlan(params: {
  seed: string
  style: WallpaperStyle
  paletteId: string
  compositionId: string
  density: number
  zone: WallpaperPlan['zone']
  reason: WallpaperPlan['reason']
}): WallpaperPlan {
  const composition =
    COMPOSITIONS.find((c) => c.id === params.compositionId) ?? COMPOSITIONS[0]
  return {
    seed: params.seed,
    generatorVersion: GENERATOR_VERSION,
    templateId: templateIdOf(params.style),
    style: params.style,
    paletteId: params.paletteId,
    compositionId: composition.id,
    density: params.density,
    shapes: buildShapes(params.style, params.seed, composition, params.density),
    animation: { kind: 'slow-drift', flickerPerSec: 0 },
    reason: params.reason,
    zone: params.zone,
  }
}
