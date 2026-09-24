import { mulberry32 } from './seed'
import { paletteById } from './palettes'
import type { Composition, PlanShape, WallpaperPlan, WallpaperStyle } from '../types'

/** 生成器版本（§4.3：升级递增，旧三元组结果仍可复现）。v2 = 山水引擎进场。 */
export const GENERATOR_VERSION = 2

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
    value === 'grid-wavefield' ||
    value === 'landscape'
  )
}

/**
 * 中点位移法生成山脊线：返回扁平坐标数组 [x0,y0,x1,y1,…]（均归一化 0..1），
 * x 均匀铺满，y 为峰谷起伏。种子化——同 rng 状态恒定同一条线。
 */
export function ridgeLine(rng: () => number, roughness: number, segments = 48): number[] {
  let heights = [rng(), rng()]
  let amplitude = roughness
  while (heights.length - 1 < segments) {
    const next: number[] = []
    for (let i = 0; i < heights.length - 1; i++) {
      const a = heights[i] as number
      const b = heights[i + 1] as number
      next.push(a, (a + b) / 2 + (rng() - 0.5) * amplitude)
    }
    next.push(heights[heights.length - 1] as number)
    heights = next
    amplitude *= 0.55
  }
  const min = Math.min(...heights)
  const span = Math.max(Math.max(...heights) - min, 1e-6)
  const points: number[] = []
  for (let i = 0; i < heights.length; i++) {
    points.push(i / (heights.length - 1), (heights[i] - min) / span)
  }
  return points
}

/**
 * 山水场景组装（Phase A.5）：天空 → 星空（夜）→ 日月 → 层峦（远/中/近，
 * 大气透视色阶）→ 雾带 → 水面 → 飞鸟。一切参数由种子驱动，渲染层零随机。
 */
export function buildLandscapeScene(
  rng: () => number,
  density: number,
  paletteId: string,
): PlanShape[] {
  const palette = paletteById(paletteId)
  const ridge = palette?.ridge ?? ['#9db8cf', '#6f94b3', '#4a7291', '#2f5570']
  const shapes: PlanShape[] = [{ kind: 'sky' }]

  const isNight = palette?.night === true
  if (isNight) {
    shapes.push({ kind: 'stars', seed: `${rng()}`, count: Math.round(60 + density * 140) })
  }

  // 日/月：挂在上方 1/3，避开正中。
  const sun = palette?.sun ?? '#ffe9b0'
  shapes.push({
    kind: 'celestial',
    x: 0.2 + rng() * 0.6,
    y: 0.1 + rng() * 0.18,
    r: isNight ? 0.035 : 0.045 + rng() * 0.025,
    color: sun,
    moon: isNight,
  })

  // 层峦三层：基线依次下移、起伏渐大、颜色渐深（大气透视）；层间偶插雾带。
  const baselines = [0.52 + rng() * 0.06, 0.62 + rng() * 0.05, 0.74 + rng() * 0.05]
  const roughness = [0.5 + density * 0.4, 0.7 + density * 0.5, 0.9 + density * 0.6]
  const alphas = [0.85, 0.92, 1]
  for (let layer = 0; layer < 3; layer++) {
    if (palette?.mist !== undefined && layer > 0 && rng() < 0.6) {
      shapes.push({
        kind: 'mist',
        y: (baselines[layer] as number) - 0.05,
        h: 0.05 + rng() * 0.04,
        color: palette.mist as string,
        alpha: 0.25 + rng() * 0.2,
      })
    }
    shapes.push({
      kind: 'ridge',
      points: ridgeLine(rng, roughness[layer] as number),
      baseY: baselines[layer] as number,
      height: 0.1 + density * 0.1 + layer * 0.03,
      color: ridge[layer] ?? (ridge[ridge.length - 1] as string),
      alpha: alphas[layer] ?? 1,
    })
  }

  // 水面（调色板含水时 60% 概率成湖）。
  if (palette?.water !== undefined && rng() < 0.6) {
    shapes.push({ kind: 'water', y: 0.82 + rng() * 0.06, color: palette.water })
  }

  // 飞鸟（仅昼景、一半概率）。
  if (!isNight && rng() < 0.45) {
    shapes.push({
      kind: 'birds',
      x: 0.15 + rng() * 0.5,
      y: 0.18 + rng() * 0.2,
      count: 3 + Math.floor(rng() * 4),
      color: '#2f3a42',
    })
  }

  return shapes
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
  /** 山水场景需要调色板配色（v2 参数；抽象风格忽略）。 */
  paletteId?: string,
): PlanShape[] {
  const rng = mulberry32(`${seed}|${templateIdOf(style)}`)
  const shapes: PlanShape[] = []

  const pick = (min: number, max: number) => min + rng() * (max - min)

  switch (style) {
    case 'landscape':
      return buildLandscapeScene(rng, density, paletteId ?? 'shanshui-day')
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
    shapes: buildShapes(params.style, params.seed, composition, params.density, params.paletteId),
    // 山水场景是完整构图，无图元级慢漂移（静态单帧，省电省性能）。
    animation:
      params.style === 'landscape'
        ? { kind: 'none', flickerPerSec: 0 }
        : { kind: 'slow-drift', flickerPerSec: 0 },
    reason: params.reason,
    zone: params.zone,
  }
}
