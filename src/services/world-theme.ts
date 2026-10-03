import { sha256Hex } from '@/core/dynamic/generative/seed'
import { paletteById } from '@/core/dynamic/generative/palettes'
import { buildFieldPlan } from '@/core/dynamic/generative/templates'
import {
  fieldCompositionsForTheme,
  type FieldTheme,
} from '@/core/dynamic/generative/gradient-field'
import { evaluateQuality } from '@/core/dynamic/governance/quality-gate'
import { hexToRgb } from '@/core/dynamic/governance/contrast'
import { eclosionAccentHex, eclosionAccentHuePassesGate } from '@/core/eclosion/world'
import type { WallpaperPlan } from '@/core/dynamic/types'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import type { EclosionWorldSummary } from '@/store/eclosion-store'
import type { EclosionReplayEntry } from './eclosion-cache'

/**
 * 今日世界 → 桌面主题（AI-GENERATED-APPS-DESIGN §6.3）：主题**不是 AI 直接写
 * CSS**，而是在现有约束空间内做选择——绝不另起渲染层。
 *
 * - 壁纸：交给现有动态桌面管线。ACTIVE_STYLES 只剩 gradient-field
 *   （2026-09-27 裁决：照片域退役、山水仅旧计划重放），世界行 wallpaper.engine
 *   仅作记录不驱动渲染；世界 paletteId 的 accent 色相在**当前主题的构图池**
 *   里选色相最近的 gradient-field 构图（不复活山水/照片引擎、不新建调色板）。
 *   seed = SHA-256(worldDate | headline)（seed.ts 同源；生成路径禁裸随机），
 *   构图照常过 evaluateQuality 质量门、经 applyOutcome 照常写入历史。
 * - 强调色：accentHue 映射到 v2 Token 的 brand/accent 族——只改色相，明度与
 *   饱和度由 Token 层固定（light=hsl(h,80%,55%) / dark=hsl(h,100%,75%)，与
 *   core/eclosion/world.ts 质量门同口径）；双主题 WCAG 对比度（≥3，UI 构件
 *   口径）不过则不落 inline（校验层已回落调色板默认色，此处纵深防御）。
 *   以 inline CSS 变量写在 documentElement 上：--ag-brand/--ag-brand-soft 经
 *   var() 引用自动跟随，主题切换时由 dynamic-desktop 重派。
 */

/** 世界壁纸种子（§6.3：hash(worldDate + headline)，同日同世界恒定）。 */
export function worldWallpaperSeed(worldDate: string, headline: string): string {
  return sha256Hex(`${worldDate}|${headline}`)
}

function hueOfHex(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const { r, g, b } = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return null
  const delta = max - min
  let hue: number
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  return Math.round(((hue % 360) + 360) % 360)
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

/** 构图代表色 = 最深层 layer 的 to（构图内最饱和的锚色，最接近「主色」语义）。 */
function fieldCompositionHue(colors: { layers: Array<{ to: string }> }): number | null {
  const deepest = colors.layers[colors.layers.length - 1]
  return deepest ? hueOfHex(deepest.to) : null
}

/**
 * 世界 paletteId → 当前主题的 gradient-field 构图 id：accent 色相最近的成员。
 * 确定性（无随机、无 seed 参与选择；并列取池内首个）。未知 paletteId 回落池首。
 */
export function resolveWorldFieldId(theme: FieldTheme, paletteId: string): string {
  const pool = fieldCompositionsForTheme(theme)
  if (pool.length === 0) return 'dawn-white'
  const target = hueOfHex(paletteById(paletteId)?.accent ?? '') ?? 220
  let best = pool[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const composition of pool) {
    const hue = fieldCompositionHue(composition)
    if (hue === null) continue
    const distance = circularHueDistance(hue, target)
    if (distance < bestDistance) {
      best = composition
      bestDistance = distance
    }
  }
  return best.id
}

/**
 * 世界主题的壁纸计划：seed 驱动 gradient-field 微变体、构图由世界 paletteId
 * 选定，照常过质量门（不过门 → null，调用方保持现壁纸，绝不应用未验证结果）。
 */
export function buildWorldWallpaperPlan(
  world: Pick<EclosionWorldSummary, 'worldDate' | 'headline' | 'paletteId'>,
  theme: 'light' | 'dark',
): WallpaperPlan | null {
  const fieldId = resolveWorldFieldId(theme, world.paletteId)
  const plan = buildFieldPlan({
    seed: worldWallpaperSeed(world.worldDate, world.headline),
    fieldId,
    zone: 'fallback',
    reason: {
      signals: [`world:${world.worldDate}`, `theme:${theme}`, `palette:${world.paletteId}`],
      palette: fieldId,
      motif: 'gradient-field',
    },
  })
  return evaluateQuality({ plan, snapshot: { theme } }).passed ? plan : null
}

// ── 强调色 Token（brand/accent 族，只改色相） ─────────────────────────────

/** brand-strong 的 Token 层基色（src/index.css）：保其明度/饱和度，仅换色相。 */
const BRAND_STRONG_BASE = { light: '#2450cf', dark: '#a7bcff' } as const

/** world 主题接管的 inline CSS 变量（documentElement.style 上，clear 时逐个移除）。 */
const WORLD_ACCENT_VARS = [
  '--ag-primary',
  '--ag-focus-ring',
  '--ag-brand-strong',
] as const

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

function hexHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const { r, g, b } = rgb
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  if (max === min) return null
  const delta = max - min
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r / 255) h = 60 * (((g / 255 - b / 255) / delta) % 6)
  else if (max === g / 255) h = 60 * ((b / 255 - r / 255) / delta + 2)
  else h = 60 * ((r / 255 - g / 255) / delta + 4)
  return { h: ((h % 360) + 360) % 360, s, l }
}

/** 只换色相：保留 base 的饱和度/明度（Token 层固定），写入目标 hue。 */
function withHue(base: string, hue: number): string {
  const hsl = hexHsl(base)
  if (hsl === null) return base
  return hslToHex(hue, hsl.s, hsl.l)
}

/** 双主题下世界 accent 覆写的 Token 值表（不落 inline 时返回 null）。 */
export function worldAccentVariables(
  hue: number,
  theme: 'light' | 'dark',
): Record<(typeof WORLD_ACCENT_VARS)[number], string> | null {
  if (!eclosionAccentHuePassesGate(hue)) return null // 对比度门不过：保持 Token 层默认
  const accent = eclosionAccentHex(hue, theme)
  return {
    '--ag-primary': accent,
    '--ag-focus-ring': accent,
    '--ag-brand-strong': withHue(BRAND_STRONG_BASE[theme], hue),
  }
}

/** 把世界 accent 写到 documentElement inline（--ag-brand/soft 经 var() 自动跟随）。 */
export function applyWorldAccent(hue: number, theme: 'light' | 'dark'): boolean {
  if (typeof document === 'undefined') return false
  const variables = worldAccentVariables(hue, theme)
  if (variables === null) return false
  for (const [name, value] of Object.entries(variables)) {
    document.documentElement.style.setProperty(name, value)
  }
  return true
}

/** 撤销世界 accent 覆写（羽化关闭/世界失效时恢复 Token 层默认）。 */
export function clearWorldAccent(): void {
  if (typeof document === 'undefined') return
  for (const name of WORLD_ACCENT_VARS) {
    document.documentElement.style.removeProperty(name)
  }
}

/** 世界主题是否接管续期（dynamic-desktop 自动换新护栏：世界在时保持当日壁纸）。 */
export function isWorldThemeActive(input: {
  enabled: boolean
  themeFollow: boolean
  worldDate: string | null
  today: string
}): boolean {
  return input.enabled && input.themeFollow && input.worldDate === input.today
}

// ── 蝶谱「回到那天的主题」（§8：只恢复主题与壁纸，不恢复应用） ─────────────

function resolvedHostTheme(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
}

/**
 * 蝶谱回放（§8）：用那日的 replay 记录重建主题——accent Token + 壁纸计划
 * （seed = hash(那日 worldDate+headline)，与当日世界同一派生），经既有
 * applyOutcome 上屏（WallpaperLayer 交叉淡入自带 prefers-reduced-motion
 * 降级，坑 71 由该层承担，此处不另做动画）。
 *
 * 边界：不写今日蝶谱、不动世界摘要/应用注册面（「只恢复主题与壁纸」）；
 * 动态桌面关闭或用户固定壁纸时只恢复强调色（铁律 1：固定即短路）；当日
 * 世界随后经主题切换/换新事件重申自己——回放是查看动作，不改变当日状态。
 */
export function applyReplayTheme(
  entry: Pick<EclosionReplayEntry, 'worldDate' | 'headline' | 'paletteId' | 'accentHue'>,
): boolean {
  const theme = resolvedHostTheme()
  applyWorldAccent(entry.accentHue, theme)
  const desktop = useDynamicDesktopStore.getState()
  if (!desktop.prefs.enabled || desktop.prefs.pinned) return false
  const plan = buildWorldWallpaperPlan(entry, theme)
  if (plan === null) return false
  useDynamicDesktopStore.getState().applyOutcome({
    outcome: { plan, level: 'L0', durationMs: 0, decisionSource: 'llm' },
    trigger: 'world',
    atMs: Date.now(),
    tier: desktop.tier,
  })
  return true
}
