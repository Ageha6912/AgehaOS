import { mulberry32 } from './seed'
import type { MessageKey } from '../../i18n'

/**
 * gradient-field — macOS Big Sur 风格生成式壁纸引擎（2026-09-27 用户裁决：
 * 「不要风景图了，参照 macOS 自行设计与现有主题相关的壁纸」；照片域整体退出，
 * 见 docs/DESIGN.md §16）。
 *
 * 形态：大面积柔和渐变色场 + 分层光滑曲面（对角流动）+ 一条弱流线；
 * 固定 10 款构图（5 亮 + 5 暗），每款自带配色；seed 只驱动曲线相位/倾斜/振幅
 * 的微变体——主结构与配色恒定，「换一张」永不翻车。
 *
 * 色彩纪律：主题令牌核心（白/淡蓝/钴蓝、藏蓝墨）+ 冷邻域低饱和点缀（青/紫/
 * 玫瑰/琥珀以设计化处理入选，用户逐款裁决）。质量门校验构图成员与主题匹配。
 */

export type FieldTheme = 'light' | 'dark'

export interface FieldComposition {
  id: string
  nameKey: MessageKey
  theme: FieldTheme
  bg: [string, string]
  layers: Array<{ from: string; to: string; base: number; amp: number }>
  accent: { color: string; base: number }
}

export const FIELD_ENGINE_VERSION = 1

export const FIELD_COMPOSITIONS: readonly FieldComposition[] = [
  {
    id: 'dawn-white',
    nameKey: 'wallpaper.field.dawnWhite',
    theme: 'light',
    bg: ['#ffffff', '#eef4fd'],
    layers: [
      { from: '#f8fbff', to: '#d9e9fc', base: 0.4, amp: 0.09 },
      { from: '#eaf3fe', to: '#bcd7f8', base: 0.62, amp: 0.12 },
      { from: '#d8e8fc', to: '#93bdf2', base: 0.84, amp: 0.09 },
    ],
    accent: { color: 'rgba(47, 95, 232, 0.1)', base: 0.34 },
  },
  {
    id: 'isle-teal',
    nameKey: 'wallpaper.field.isleTeal',
    theme: 'light',
    bg: ['#f0fbfc', '#cfeef1'],
    layers: [
      { from: '#e0f6f8', to: '#aee4e8', base: 0.4, amp: 0.1 },
      { from: '#cdf0f2', to: '#84d2da', base: 0.62, amp: 0.12 },
      { from: '#b2e4e9', to: '#4fb6c4', base: 0.84, amp: 0.09 },
      { from: '#7fd0da', to: '#2b9aab', base: 0.95, amp: 0.07 },
    ],
    accent: { color: 'rgba(255, 255, 255, 0.22)', base: 0.5 },
  },
  {
    id: 'violet-mist',
    nameKey: 'wallpaper.field.violetMist',
    theme: 'light',
    bg: ['#f9f7fe', '#e2d9f8'],
    layers: [
      { from: '#f1ecfd', to: '#cfc2f5', base: 0.4, amp: 0.1 },
      { from: '#e4dbfa', to: '#b39aef', base: 0.62, amp: 0.12 },
      { from: '#d2c2f4', to: '#8f74dd', base: 0.84, amp: 0.09 },
      { from: '#b7a1ec', to: '#6d4fc9', base: 0.95, amp: 0.07 },
    ],
    accent: { color: 'rgba(255, 255, 255, 0.18)', base: 0.46 },
  },
  {
    id: 'rose-dawn',
    nameKey: 'wallpaper.field.roseDawn',
    theme: 'light',
    bg: ['#fff8fa', '#fbdae4'],
    layers: [
      { from: '#fef0f4', to: '#f6c3d4', base: 0.4, amp: 0.1 },
      { from: '#fde0ea', to: '#f19cb8', base: 0.62, amp: 0.12 },
      { from: '#f9cbda', to: '#e56f97', base: 0.84, amp: 0.09 },
      { from: '#f2a9c2', to: '#d44577', base: 0.95, amp: 0.07 },
    ],
    accent: { color: 'rgba(255, 255, 255, 0.2)', base: 0.48 },
  },
  {
    id: 'amber-morn',
    nameKey: 'wallpaper.field.amberMorn',
    theme: 'light',
    bg: ['#fffaf2', '#fdeccd'],
    layers: [
      { from: '#fdf3e2', to: '#f8d9a4', base: 0.4, amp: 0.1 },
      { from: '#fbe9c6', to: '#f0bd72', base: 0.62, amp: 0.12 },
      { from: '#f6d7a4', to: '#e09a3e', base: 0.84, amp: 0.09 },
      { from: '#efc078', to: '#c47a1d', base: 0.95, amp: 0.07 },
    ],
    accent: { color: 'rgba(255, 255, 255, 0.2)', base: 0.46 },
  },
  {
    id: 'night-veil',
    nameKey: 'wallpaper.field.nightVeil',
    theme: 'dark',
    bg: ['#0c1220', '#182648'],
    layers: [
      { from: '#101a2e', to: '#1d2f56', base: 0.42, amp: 0.1 },
      { from: '#17254a', to: '#2a4494', base: 0.66, amp: 0.12 },
      { from: '#1e3268', to: '#3a5fd0', base: 0.88, amp: 0.09 },
    ],
    accent: { color: 'rgba(130, 163, 255, 0.14)', base: 0.38 },
  },
  {
    id: 'aurora-night',
    nameKey: 'wallpaper.field.auroraNight',
    theme: 'dark',
    bg: ['#07131a', '#0b2a2e'],
    layers: [
      { from: '#0a1f26', to: '#11403c', base: 0.42, amp: 0.1 },
      { from: '#0e3232', to: '#176353', base: 0.66, amp: 0.12 },
      { from: '#124744', to: '#1f8a6e', base: 0.88, amp: 0.09 },
    ],
    accent: { color: 'rgba(110, 235, 190, 0.14)', base: 0.5 },
  },
  {
    id: 'dusk-rose',
    nameKey: 'wallpaper.field.duskRose',
    theme: 'dark',
    bg: ['#14090f', '#33122a'],
    layers: [
      { from: '#1c0b14', to: '#461538', base: 0.42, amp: 0.1 },
      { from: '#2a1126', to: '#671f56', base: 0.66, amp: 0.12 },
      { from: '#381737', to: '#8c2d76', base: 0.88, amp: 0.09 },
    ],
    accent: { color: 'rgba(255, 130, 170, 0.12)', base: 0.5 },
  },
  {
    id: 'violet-night',
    nameKey: 'wallpaper.field.violetNight',
    theme: 'dark',
    bg: ['#0d0a1a', '#231543'],
    layers: [
      { from: '#130e26', to: '#2a1e55', base: 0.42, amp: 0.1 },
      { from: '#1c1440', to: '#3b2b8a', base: 0.66, amp: 0.12 },
      { from: '#251b56', to: '#4f3ab8', base: 0.88, amp: 0.09 },
    ],
    accent: { color: 'rgba(190, 160, 255, 0.14)', base: 0.5 },
  },
  {
    id: 'amber-night',
    nameKey: 'wallpaper.field.amberNight',
    theme: 'dark',
    bg: ['#120d08', '#2b1c0a'],
    layers: [
      { from: '#1a1208', to: '#3d2a0e', base: 0.42, amp: 0.1 },
      { from: '#241a0c', to: '#5c3f12', base: 0.66, amp: 0.12 },
      { from: '#2e2210', to: '#7a5418', base: 0.88, amp: 0.09 },
    ],
    accent: { color: 'rgba(255, 200, 110, 0.13)', base: 0.5 },
  },
]

export function fieldCompositionById(id: string): FieldComposition | undefined {
  return FIELD_COMPOSITIONS.find((composition) => composition.id === id)
}

/** 主题适配池：亮构图配浅色主题、暗构图配深色主题（§2.1 的生成域版本）。 */
export function fieldCompositionsForTheme(theme: FieldTheme): FieldComposition[] {
  return FIELD_COMPOSITIONS.filter((composition) => composition.theme === theme)
}

/** 平滑边界曲线：对角倾斜 + 大振幅缓弧（seed 定方向与相位，主结构恒定）。 */
function boundaryPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: number,
  amp: number,
  rnd: () => number,
): void {
  const baseY = h * base
  const slope = (rnd() - 0.5) * h * 0.16
  const a1 = h * amp * (0.9 + rnd() * 0.9)
  const a2 = h * amp * (0.5 + rnd() * 0.8)
  const phase1 = rnd() * Math.PI * 2
  const phase2 = rnd() * Math.PI * 2
  const freq1 = 1 + Math.floor(rnd() * 2)
  const freq2 = 2 + Math.floor(rnd() * 2)

  const points: Array<[number, number]> = []
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y =
      baseY +
      slope * (t - 0.5) * 2 +
      a1 * Math.sin(t * Math.PI * freq1 + phase1) +
      a2 * Math.sin(t * Math.PI * freq2 + phase2)
    points.push([w * t, y])
  }

  ctx.beginPath()
  ctx.moveTo(0, h + 2)
  ctx.lineTo(points[0]![0], points[0]![1])
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]!
    const [cx, cy] = points[i]!
    ctx.quadraticCurveTo(px, py, (px + cx) / 2, (py + cy) / 2)
  }
  ctx.lineTo(w, h + 2)
  ctx.closePath()
}

/** 弱流线：一条横贯画面的低对比发光带（Q1:C 的「最低剂量」）。 */
function accentRibbon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: FieldComposition['accent'],
  rnd: () => number,
): void {
  const y = h * (accent.base + (rnd() - 0.5) * 0.06)
  const tilt = (rnd() - 0.5) * h * 0.08
  const gradient = ctx.createLinearGradient(0, 0, w, 0)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(0.5, accent.color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.filter = 'blur(22px)'
  ctx.strokeStyle = gradient
  ctx.lineWidth = h * 0.06
  ctx.beginPath()
  ctx.moveTo(-w * 0.05, y + tilt)
  ctx.bezierCurveTo(w * 0.3, y - h * 0.05, w * 0.7, y + h * 0.05, w * 1.05, y - tilt)
  ctx.stroke()
  ctx.restore()
}

/** 主绘制入口：背景 → 层（后前有序、边界柔化）→ 流线。确定性（seed 可重放）。 */
export function drawGradientField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  composition: FieldComposition,
  seed: string,
): void {
  const rnd = mulberry32(seed)

  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, composition.bg[0])
  bg.addColorStop(1, composition.bg[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  for (const layer of composition.layers) {
    ctx.save()
    ctx.filter = 'blur(18px)'
    boundaryPath(ctx, w, h, layer.base, layer.amp, rnd)
    const gradient = ctx.createLinearGradient(0, h * (layer.base - layer.amp), 0, h)
    gradient.addColorStop(0, layer.from)
    gradient.addColorStop(1, layer.to)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.restore()
  }

  accentRibbon(ctx, w, h, composition.accent, rnd)
}

