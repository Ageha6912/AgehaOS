import { DENSITY_LEVELS, WALLPAPER_STYLES } from '../types'
import type { WallpaperPlan, WallpaperStyle } from '../types'
import { paletteById } from '../generative/palettes'
import { COMPOSITIONS } from '../generative/templates'

/**
 * 内容安全过滤管线（设计文档 §8.4，铁律 7）：渲染前同步过滤。
 * Phase A 产物为参数化计划，本地管线 = schema 白名单校验 + 屏蔽名单；
 * 违规产物不进任何状态、不上屏。
 */

export interface SafetyInput {
  plan: WallpaperPlan
  /** 用户屏蔽的风格标签（§6.5，≤200 条）。 */
  blockedStyles: readonly string[]
}

export interface SafetyResult {
  allowed: boolean
  reason?: 'schema' | 'blocked-style'
}

export function safetyFilter(input: SafetyInput): SafetyResult {
  const schemaError = validatePlanSchema(input.plan)
  if (schemaError) return { allowed: false, reason: 'schema' }
  if (input.blockedStyles.includes(input.plan.style)) {
    return { allowed: false, reason: 'blocked-style' }
  }
  return { allowed: true }
}

/** 计划 schema 白名单：未知字段在类型层已挡，这里校验值域（§5.4 参数 schema 校验，非法即回退默认模板）。 */
export function validatePlanSchema(plan: WallpaperPlan): string | null {
  if (!WALLPAPER_STYLES.includes(plan.style)) return `unknown style: ${plan.style}`
  if (!paletteById(plan.paletteId)) return `unknown palette: ${plan.paletteId}`
  if (!COMPOSITIONS.some((c) => c.id === plan.compositionId)) {
    return `unknown composition: ${plan.compositionId}`
  }
  if (!(DENSITY_LEVELS as readonly number[]).includes(plan.density)) {
    return `unknown density: ${plan.density}`
  }
  if (typeof plan.seed !== 'string' || plan.seed.length === 0) return 'missing seed'
  if (!Number.isInteger(plan.generatorVersion) || plan.generatorVersion < 1) {
    return `bad generatorVersion: ${plan.generatorVersion}`
  }
  if (plan.animation.flickerPerSec > 3) return 'flicker exceeds photosafety limit'
  return null
}

export function isWallpaperStyleValue(value: string): value is WallpaperStyle {
  return (WALLPAPER_STYLES as readonly string[]).includes(value)
}
