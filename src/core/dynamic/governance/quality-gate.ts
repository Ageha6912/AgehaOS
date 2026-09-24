import { paletteById } from '../generative/palettes'
import { photoById } from '../photos/catalog'
import type { ContextSnapshot, WallpaperPlan } from '../types'
import { blendHex, contrastRatio, hexToRgb } from './contrast'

/**
 * 质量门（设计文档 §4.4，铁律 2）：任一不过即不合格、不得上屏。
 * Phase A 全部为「本地项」，在参数空间完成（程序化生成无位图，无需拉普拉斯/分辨率采样）。
 * 不合格处置：可行域内重采样最多 3 次（§6.2），仍失败逐级兜底（§9.1）。
 *
 * 亮度口径说明：§4.4 的绝对窗口 [0.2, 0.85] 以四角/中心均亮为准；AgehaOS 深色优先的
 * 设计语言（v0.1 默认渐变均亮 ≈0.10）在该绝对窗口下必然被拒，故 Phase A 以「感知亮度
 * （RGB 均值/255）+ 按主题相对窗口」实现同一质量意图，偏差已登记 ARCHITECTURE.md。
 */

/** 正文对比度下限（WCAG AA）。 */
export const CONTRAST_TEXT = 4.5
/** UI 构件（任务栏区、徽标区）对比度下限。 */
export const CONTRAST_UI = 3
/** 文字区自动叠加的最大遮罩强度（§4.4：0–40%）。 */
export const MAX_SCRIM = 0.4
/** 光敏安全：全屏闪烁上限（次/秒）。 */
export const MAX_FLICKER_PER_SEC = 3
/** 装饰元素重叠率上限。 */
export const MAX_OVERLAP_RATIO = 0.3

/** 文字墨色取自设计 Token（src/index.css：--ag-text 双主题值，warm stone 色板）。 */
export const INK_DARK = '#1c1917'
export const INK_LIGHT = '#e7e5e4'
export const SURFACE_DARK = '#1c1917'
export const SURFACE_LIGHT = '#ffffff'

/** 感知亮度：RGB 均值 / 255（0–1）。 */
export function perceptualBrightness(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return (rgb.r + rgb.g + rgb.b) / (3 * 255)
}

/** 按主题的亮度窗口（Phase A 对 §4.4 绝对窗口的相对化标定）。 */
export function brightnessRangeFor(theme: 'light' | 'dark'): { min: number; max: number } {
  return theme === 'dark' ? { min: 0.08, max: 0.85 } : { min: 0.55, max: 0.93 }
}

export interface QualityInput {
  plan: WallpaperPlan
  snapshot: Pick<ContextSnapshot, 'theme'>
}

export interface QualityViolation {
  item: 'brightness' | 'contrast' | 'flicker' | 'overlap' | 'schema'
  detail: string
}

export interface QualityResult {
  passed: boolean
  violations: QualityViolation[]
}

export function evaluateQuality(input: QualityInput): QualityResult {
  const violations: QualityViolation[] = []
  const { plan } = input
  const palette = paletteById(plan.paletteId)

  // 照片计划（Phase A.6）：位图无调色板/对比度口径，校验目录成员 + 主题 mood 匹配。
  if (plan.style === 'photo') {
    const photo = plan.photoId !== undefined ? photoById(plan.photoId) : undefined
    if (!photo) {
      return {
        passed: false,
        violations: [{ item: 'schema', detail: `unknown photo ${plan.photoId ?? '(none)'}` }],
      }
    }
    if (photo.mood !== input.snapshot.theme) {
      violations.push({
        item: 'schema',
        detail: `photo mood ${photo.mood} does not match theme ${input.snapshot.theme}`,
      })
    }
    if (plan.animation.flickerPerSec > MAX_FLICKER_PER_SEC) {
      violations.push({ item: 'flicker', detail: `flickerPerSec=${plan.animation.flickerPerSec}` })
    }
    return { passed: violations.length === 0, violations }
  }

  if (!palette) {
    return {
      passed: false,
      violations: [{ item: 'schema', detail: `unknown palette ${plan.paletteId}` }],
    }
  }
  const surface = input.snapshot.theme === 'dark' ? SURFACE_DARK : SURFACE_LIGHT
  const themeInk = input.snapshot.theme === 'dark' ? INK_LIGHT : INK_DARK

  // 亮度门（§4.4 相对化：见文件头说明）。
  let brightnessSum = 0
  for (const stop of palette.stops) {
    const b = perceptualBrightness(stop)
    if (b === null) {
      violations.push({ item: 'schema', detail: `invalid stop color ${stop}` })
      brightnessSum = Number.NaN
      break
    }
    brightnessSum += b
  }
  if (!Number.isNaN(brightnessSum)) {
    const brightness = brightnessSum / palette.stops.length
    const range = brightnessRangeFor(input.snapshot.theme)
    if (brightness < range.min || brightness > range.max) {
      violations.push({
        item: 'brightness',
        detail: `averageBrightness=${brightness.toFixed(3)} outside [${range.min}, ${range.max}]`,
      })
    }
  }

  // 正文可读门：任一 stop 上，深/浅墨色（含 40% 遮罩辅助）至少一种达到 WCAG AA。
  const scrimmedVariants = (stop: string) => [
    stop,
    blendHex(surface, stop, MAX_SCRIM) ?? stop,
  ]
  for (const stop of palette.stops) {
    const best = Math.max(
      ...scrimmedVariants(stop).flatMap((bg) => [
        contrastRatio(INK_DARK, bg) ?? 0,
        contrastRatio(INK_LIGHT, bg) ?? 0,
      ]),
    )
    if (best < CONTRAST_TEXT) {
      violations.push({ item: 'contrast', detail: `textContrast=${best.toFixed(2)} < ${CONTRAST_TEXT}` })
      break
    }
  }

  // UI 构件门（任务栏/徽标区，取最底部 stop）：主题墨色叠加遮罩后 ≥3:1。
  const bottomStop = palette.stops[palette.stops.length - 1]
  const uiBest = Math.max(
    contrastRatio(themeInk, bottomStop) ?? 0,
    contrastRatio(themeInk, blendHex(surface, bottomStop, MAX_SCRIM) ?? bottomStop) ?? 0,
  )
  if (uiBest < CONTRAST_UI) {
    violations.push({ item: 'contrast', detail: `uiContrast=${uiBest.toFixed(2)} < ${CONTRAST_UI}` })
  }

  // 光敏安全门（§4.4）。
  if (plan.animation.flickerPerSec > MAX_FLICKER_PER_SEC) {
    violations.push({ item: 'flicker', detail: `flickerPerSec=${plan.animation.flickerPerSec}` })
  }

  // 装饰重叠门（§4.4 <30%；全宽横带为山水层，不计入）。
  const overlap = decorativeOverlapRatio(plan.shapes)
  if (overlap >= MAX_OVERLAP_RATIO) {
    violations.push({ item: 'overlap', detail: `overlap=${overlap.toFixed(2)}` })
  }

  return { passed: violations.length === 0, violations }
}

/**
 * 装饰图元两两重叠面积 / 图元总面积（单位坐标系，圆按外接方框近似）。
 * 口径：只约束矩形装饰（几何构成、网格瓦片）——流体色块与粒子（圆形）本就是相互融合的
 * 渐变层，山水全宽层为分层剪影，三者重叠属设计意图，不适用「装饰重叠」门。
 */
type RectShape = Extract<WallpaperPlan['shapes'][number], { kind: 'rect' }>

export function decorativeOverlapRatio(shapes: WallpaperPlan['shapes']): number {
  const decor = shapes.filter((s): s is RectShape => s.kind === 'rect' && s.w < 0.98)
  if (decor.length <= 1) return 0
  const area = (s: RectShape) => s.w * s.h
  let total = 0
  let overlapSum = 0
  for (let i = 0; i < decor.length; i++) {
    total += area(decor[i])
    for (let j = i + 1; j < decor.length; j++) {
      overlapSum += intersectionArea(decor[i], decor[j])
    }
  }
  if (total <= 0) return 0
  return overlapSum / total
}

function intersectionArea(a: RectShape, b: RectShape): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
