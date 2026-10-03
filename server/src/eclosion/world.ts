import { randomUUID } from 'node:crypto'

import type { EclosionConfig } from '../config'
import { classifyContentText } from '../classifier'
import type { DataStore } from '../store/types'
import { ECLOSION_BUDGET_KEY } from './quota'
import { buildWorldMessages } from './prompts'
import type { TrendingService } from './trending'
import { estimateTokens, streamEclosionCompletion } from './upstream'
import {
  WORLD_CATEGORIES,
  WORLD_ICON_WHITELIST,
  WORLD_NAME_BLOCKLIST,
  WORLD_PALETTES,
  isWorldPaletteId,
  type WorldCategory,
} from './world-data'

/**
 * 今日世界（AI-GENERATED-APPS-DESIGN §6.2）：上游以 JSON Lines 输出，服务端
 * 逐行严格校验、非法行丢弃；合法 app 行不足 6 或超过 10 → 整段 invalid。
 *
 * 行级规则与客户端 `src/core/eclosion/world.ts` **同口径、两侧独立实现**
 * （server 禁止依赖 src/）；一致性由 server/test/eclosion-world.test.ts 动态
 * 引入客户端模块、以同一批正反例字面量比对钉死（照 spec 表读文件先例）。
 *
 * - `paletteId` 白名单 = 抽象调色板 24 组（山水 shanshui-* 不入世界可选项：
 *   山水域 2026-09-27 裁决退役、仅旧计划重放）；accent 静态副本在 world-data.ts。
 * - `accentHue` 过 WCAG 对比度门（口径对齐 src/core/dynamic/governance：
 *   light=hsl(h,80%,55%) 对 #fbfdff、dark=hsl(h,100%,75%) 对 #141b2b，阈值 3），
 *   不合格回落该调色板默认 accent 的色相；再不合格回落 220。
 * - `icon` 属 Phosphor 白名单（防脏数据；客户端渲染走 AppIcon 确定性徽章，
 *   icon 不驱动渲染——2026-10-02 裁决）。
 * - `name/tagline/headline` 过 classifier，violation 即弃（行级/整段）。
 * - hint ≤400 字、**只存服务端**（ADR 27：GET /world 永不下发）。
 */

export {
  WORLD_CATEGORIES,
  WORLD_ICON_WHITELIST,
  WORLD_NAME_BLOCKLIST,
  WORLD_PALETTES,
  isWorldPaletteId,
} from './world-data'
export type { WorldCategory } from './world-data'

export const WORLD_MIN_APPS = 6
export const WORLD_MAX_APPS = 10
export const MAX_WORLD_NAME_CHARS = 12
export const MAX_WORLD_TAGLINE_CHARS = 80
export const MAX_WORLD_HEADLINE_CHARS = 60
export const MAX_WORLD_HINT_CHARS = 400
/** 上游世界输出上限（10 个 app 行 + theme 的安全余量）。 */
export const MAX_WORLD_OUTPUT_CHARS = 120_000

// ── 色彩数学（与 src/core/dynamic/governance/contrast.ts 同口径，独立实现）──

const SURFACE_LIGHT = '#fbfdff'
const SURFACE_DARK = '#141b2b'
const CONTRAST_UI = 3

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const int = Number.parseInt(match[1], 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return 0
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
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

function hexHue(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const { r, g, b } = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return null // 无色相（灰）
  const delta = max - min
  let hue: number
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  return Math.round(((hue % 360) + 360) % 360)
}

/**
 * accentHue → 双主题 accent hex（§6.3：只改色相，明度/饱和度 Token 层固定）。
 * light ≈ #2f5fe8 族（hsl 80%/55%）、dark ≈ #82a3ff 族（hsl 100%/75%）。
 */
export function worldAccentHex(hue: number, theme: 'light' | 'dark'): string {
  return theme === 'light' ? hslToHex(hue, 0.8, 0.55) : hslToHex(hue, 1.0, 0.75)
}

/** accentHue 质量门：双主题对各自 surface 的 WCAG 对比度 ≥3（UI 构件口径）。 */
export function accentHuePassesGate(hue: number): boolean {
  return (
    contrastRatio(worldAccentHex(hue, 'light'), SURFACE_LIGHT) >= CONTRAST_UI &&
    contrastRatio(worldAccentHex(hue, 'dark'), SURFACE_DARK) >= CONTRAST_UI
  )
}

/** accentHue 门不合格时回落：调色板默认 accent 的色相 → 再不合格 220（中蓝）。 */
export function resolveAccentHue(hue: number, paletteId: string): number {
  if (accentHuePassesGate(hue)) return hue
  const fallbackHue = hexHue(WORLD_PALETTES[paletteId] ?? '')
  if (fallbackHue !== null && accentHuePassesGate(fallbackHue)) return fallbackHue
  return 220
}

// ── 类型与行级校验 ───────────────────────────────────────────────────────────

export interface WorldWallpaper {
  /** 记录字段（2026-10-02 裁决：engine 仅记录，不驱动渲染——渲染走现行动态桌面管线）。 */
  engine: string
  paletteId: string
  mood: string
}

export interface WorldThemeLine {
  headline: string
  paletteId: string
  accentHue: number
  wallpaper: WorldWallpaper
}

export interface WorldAppWindow {
  width: number
  height: number
}

export interface WorldAppLine {
  slug: string
  name: string
  icon: string
  hue: number
  tagline: string
  category: WorldCategory
  /** ≤400 字功能描述：生成 kind=today 的规格 hint，只存服务端（ADR 27）。 */
  hint: string
  window: WorldAppWindow
}

export interface WorldRecord {
  worldDate: string
  generatedAt: string
  /** true = 无热点锚点纯想象降级（§6.1）。 */
  degraded: boolean
  signalTitles: string[]
  source: { name: string; url: string }
  theme: WorldThemeLine
  apps: WorldAppLine[]
}

export type WorldParseFailure =
  | 'empty'
  | 'no-theme'
  | 'too-few-apps'
  | 'too-many-apps'
  | 'oversize'

export type WorldParseResult =
  | { ok: true; record: WorldRecord }
  | { ok: false; reason: WorldParseFailure }

const SLUG_PATTERN = /^[a-z0-9-]{2,32}$/
const NAME_BLOCKSET = new Set(WORLD_NAME_BLOCKLIST.map((name) => name.toLowerCase()))
const ICON_SET = new Set(WORLD_ICON_WHITELIST)
const CATEGORY_SET = new Set<string>(WORLD_CATEGORIES)
const DEFAULT_APP_WINDOW: WorldAppWindow = { width: 720, height: 480 }
const FALLBACK_WALLPAPER_MOOD = 'calm'

function lengthInPoints(text: string): number {
  return Array.from(text).length
}

function truncateByPoints(text: string, max: number): string {
  const points = Array.from(text)
  return points.length <= max ? text : points.slice(0, max).join('')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 主题行校验：headline/paletteId/accentHue/wallpaper 全规则（§6.2）。 */
export function sanitizeThemeLine(value: unknown): WorldThemeLine | null {
  if (!isPlainObject(value) || value.type !== 'theme') return null
  const headline = typeof value.headline === 'string' ? value.headline.trim() : ''
  if (headline.length === 0 || lengthInPoints(headline) > MAX_WORLD_HEADLINE_CHARS) return null
  // 过 filterContentText 全口径（§6.2）：三类任一命中即弃（与客户端一致）。
  if (classifyContentText(headline).classification !== 'ok') return null

  const paletteId = typeof value.paletteId === 'string' ? value.paletteId : ''
  if (!isWorldPaletteId(paletteId)) return null

  const rawHue = value.accentHue
  if (typeof rawHue !== 'number' || !Number.isInteger(rawHue) || rawHue < 0 || rawHue > 359) {
    return null
  }
  const accentHue = resolveAccentHue(rawHue, paletteId)

  // wallpaper 为记录字段：形状收敛、paletteId 非白名单回落主题 paletteId。
  let wallpaper: WorldWallpaper = {
    engine: 'dynamic-desktop',
    paletteId,
    mood: FALLBACK_WALLPAPER_MOOD,
  }
  const rawWallpaper = value.wallpaper
  if (isPlainObject(rawWallpaper)) {
    const engine = typeof rawWallpaper.engine === 'string' ? rawWallpaper.engine.trim() : ''
    const mood = typeof rawWallpaper.mood === 'string' ? rawWallpaper.mood.trim() : ''
    const wpPalette =
      typeof rawWallpaper.paletteId === 'string' && isWorldPaletteId(rawWallpaper.paletteId)
        ? rawWallpaper.paletteId
        : paletteId
    wallpaper = {
      engine: engine.length > 0 ? truncateByPoints(engine, 24) : wallpaper.engine,
      paletteId: wpPalette,
      mood: mood.length > 0 ? truncateByPoints(mood, 24) : wallpaper.mood,
    }
  }

  return { headline, paletteId, accentHue, wallpaper }
}

function sanitizeWindow(value: unknown): WorldAppWindow {
  if (!isPlainObject(value)) return { ...DEFAULT_APP_WINDOW }
  const width =
    typeof value.width === 'number' && Number.isFinite(value.width) ? Math.round(value.width) : NaN
  const height =
    typeof value.height === 'number' && Number.isFinite(value.height) ? Math.round(value.height) : NaN
  return {
    width: width >= 240 && width <= 1920 ? width : DEFAULT_APP_WINDOW.width,
    height: height >= 160 && height <= 1200 ? height : DEFAULT_APP_WINDOW.height,
  }
}

/** app 行校验：slug/name/icon/hue/tagline/category/hint/window 全规则（§6.2）。 */
export function sanitizeAppLine(value: unknown): WorldAppLine | null {
  if (!isPlainObject(value) || value.type !== 'app') return null

  const slug = typeof value.slug === 'string' ? value.slug : ''
  if (!SLUG_PATTERN.test(slug)) return null

  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (name.length === 0 || lengthInPoints(name) > MAX_WORLD_NAME_CHARS) return null
  if (NAME_BLOCKSET.has(name.toLowerCase())) return null

  const icon = typeof value.icon === 'string' ? value.icon : ''
  if (!ICON_SET.has(icon)) return null

  const hue = value.hue
  if (typeof hue !== 'number' || !Number.isInteger(hue) || hue < 0 || hue > 359) return null

  const tagline = typeof value.tagline === 'string' ? value.tagline.trim() : ''
  if (tagline.length === 0 || lengthInPoints(tagline) > MAX_WORLD_TAGLINE_CHARS) return null

  const category = typeof value.category === 'string' ? value.category : ''
  if (!CATEGORY_SET.has(category)) return null

  if (
    classifyContentText(name).classification !== 'ok' ||
    classifyContentText(tagline).classification !== 'ok' ||
    classifyContentText(`${name} ${tagline}`).classification !== 'ok'
  ) {
    return null
  }

  // hint 宽容：非串/超长一律截断而非弃行（hint 只影响生成质量，不影响安全面）。
  const hint =
    typeof value.hint === 'string' ? truncateByPoints(value.hint.trim(), MAX_WORLD_HINT_CHARS) : ''

  return {
    slug,
    name,
    icon,
    hue,
    tagline,
    category: category as WorldCategory,
    hint,
    window: sanitizeWindow(value.window),
  }
}

export interface WorldParseContext {
  worldDate: string
  generatedAt?: string
  degraded?: boolean
  signalTitles?: readonly string[]
  source?: { name: string; url: string }
}

/** JSON Lines 逐行解析 + 校验（§6.2：非法行丢弃；合法 app 行 6–10 否则整段 invalid）。 */
export function parseWorldLines(raw: string, context: WorldParseContext): WorldParseResult {
  if (raw.length > MAX_WORLD_OUTPUT_CHARS) return { ok: false, reason: 'oversize' }
  const lines = raw.split(/\r?\n/).map((line) => line.trim())
  if (lines.length === 0) return { ok: false, reason: 'empty' }

  let theme: WorldThemeLine | null = null
  const apps: WorldAppLine[] = []
  const seenSlugs = new Set<string>()
  for (const line of lines) {
    if (line.length === 0) continue
    // 围栏/前缀容忍：只认以 { 开头的 JSON 行（``` 围栏与寒暄自然跳过）。
    const jsonStart = line.indexOf('{')
    if (jsonStart < 0) continue
    const candidate = line.slice(jsonStart, line.endsWith('}') ? line.length : line.lastIndexOf('}') + 1)
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue // 非法行丢弃（§6.2）
    }
    if (theme === null) {
      const maybeTheme = sanitizeThemeLine(parsed)
      if (maybeTheme !== null) {
        theme = maybeTheme
        continue
      }
    }
    const app = sanitizeAppLine(parsed)
    if (app === null || seenSlugs.has(app.slug)) continue // 日内 slug 唯一
    seenSlugs.add(app.slug)
    apps.push(app)
  }

  if (theme === null) return { ok: false, reason: 'no-theme' }
  if (apps.length < WORLD_MIN_APPS) return { ok: false, reason: 'too-few-apps' }
  if (apps.length > WORLD_MAX_APPS) return { ok: false, reason: 'too-many-apps' }
  return {
    ok: true,
    record: {
      worldDate: context.worldDate,
      generatedAt: context.generatedAt ?? new Date().toISOString(),
      degraded: context.degraded ?? false,
      signalTitles: [...(context.signalTitles ?? [])],
      source: context.source ?? { name: 'unknown', url: '' },
      theme,
      apps,
    },
  }
}

// ── 存储键与对外载荷 ─────────────────────────────────────────────────────────

/** 全局当日世界键（§9.2 全局按日生成一次，所有用户共享）。 */
export function worldGlobalKey(day: string): string {
  return `world:${day}`
}

/** 个人重生成版键（§6.2 个人版本，跨日自然失效）。 */
export function worldPersonalKey(day: string, userId: string): string {
  return `world:${day}:u:${userId}`
}

/** 世界生成单飞锁（懒触发与 scheduler 共用，坑 73 次序：acquire → 补读缓存）。 */
export function worldGenLockKey(day: string): string {
  return `world:gen:${day}`
}

/** L2 HTML 全局缓存键（§9.2：(worldDate, slug, model)）。 */
export function todayCacheKey(day: string, slug: string, model: string): string {
  return `today:${day}:${slug}:${model}`
}

export interface PublicWorldApp {
  slug: string
  name: string
  icon: string
  hue: number
  tagline: string
  category: WorldCategory
  window: WorldAppWindow
}

export interface PublicWorldPayload {
  worldDate: string
  generatedAt: string
  degraded: boolean
  signalCount: number
  signals: { titles: readonly string[]; sourceName: string; sourceUrl: string }
  theme: Omit<WorldThemeLine, never>
  apps: PublicWorldApp[]
}

/** GET /world 响应载荷：剥 hint（ADR 27），apps 只留公开字段。 */
export function publicWorldPayload(record: WorldRecord): PublicWorldPayload {
  return {
    worldDate: record.worldDate,
    generatedAt: record.generatedAt,
    degraded: record.degraded,
    signalCount: record.signalTitles.length,
    signals: {
      titles: [...record.signalTitles],
      sourceName: record.source.name,
      sourceUrl: record.source.url,
    },
    theme: { ...record.theme, wallpaper: { ...record.theme.wallpaper } },
    apps: record.apps.map((app) => ({
      slug: app.slug,
      name: app.name,
      icon: app.icon,
      hue: app.hue,
      tagline: app.tagline,
      category: app.category,
      window: { ...app.window },
    })),
  }
}

/** 存储读回的世界记录再校验（纵深防御：写时已校验，读回仍不信任）。 */
export function parseStoredWorld(raw: string, day: string): WorldRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  const result = parseWorldLines(
    [
      JSON.stringify({ type: 'theme', ...((parsed.theme as Record<string, unknown>) ?? {}) }),
      ...((Array.isArray(parsed.apps) ? parsed.apps : []) as unknown[]).map((app) =>
        JSON.stringify({ type: 'app', ...(app as Record<string, unknown>) }),
      ),
    ].join('\n'),
    {
      worldDate: day,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
      degraded: parsed.degraded === true,
      signalTitles: Array.isArray(parsed.signalTitles)
        ? (parsed.signalTitles as unknown[]).filter(
            (title): title is string => typeof title === 'string',
          )
        : [],
      source: isPlainObject(parsed.source)
        ? {
            name: typeof parsed.source.name === 'string' ? parsed.source.name : 'unknown',
            url: typeof parsed.source.url === 'string' ? parsed.source.url : '',
          }
        : { name: 'unknown', url: '' },
    },
  )
  // 读回的 hint 在 JSON.stringify(theme/app) 原样带过——parseWorldLines 的
  // sanitize 会截断到 400 字；写时已同规则，正常路径无损。
  return result.ok ? result.record : null
}

// ── 世界合成（上游 JSON Lines + 重试一次） ──────────────────────────────────

export type WorldSynthesisFailure =
  | 'ai-not-configured'
  | 'ai-upstream'
  | 'ai-timeout'
  | 'invalid-output'
  | 'budget-exceeded'

export interface SynthesizeWorldParams {
  store: DataStore
  eclosion: EclosionConfig
  trending: TrendingService
  fetcher: typeof fetch
  /** 全局世界固定 zh-CN（所有用户共享一份，§6.2）。 */
  locale?: 'zh-CN' | 'en'
  /** 世界归属日（默认 now() 的 UTC 日；scheduler/测试可显式传）。 */
  day?: string
  now?: () => Date
}

export interface SynthesizeWorldSuccess {
  ok: true
  record: WorldRecord
  tokens: number
  attempts: number
}

export interface SynthesizeWorldFailure {
  ok: false
  code: WorldSynthesisFailure
  detail?: string
}

export async function synthesizeWorld(params: SynthesizeWorldParams): Promise<
  SynthesizeWorldSuccess | SynthesizeWorldFailure
> {
  const { store, eclosion, trending, fetcher } = params
  const locale = params.locale ?? 'zh-CN'
  const now = params.now ?? ((): Date => new Date())
  if (!eclosion.apiKey) return { ok: false, code: 'ai-not-configured' }

  // 全局 token 预算是硬顶（§9.3）：世界生成同样计入、超顶不再发起。
  const day = params.day ?? now().toISOString().slice(0, 10)
  const budgetUsed = await store.getEclosionDaily(ECLOSION_BUDGET_KEY, day)
  if (budgetUsed >= eclosion.dailyTokenBudget) return { ok: false, code: 'budget-exceeded' }

  const snapshot = await trending.getSnapshot()
  const messages = buildWorldMessages(
    {
      items: snapshot.items.map((item) => ({ title: item.title, description: item.description })),
      degraded: snapshot.degraded,
    },
    locale,
  )
  const promptChars = JSON.stringify(messages).length
  let tokens = 0

  /**
   * 单次尝试计入全局预算：上游 usage 优先，缺省按提示词+已收流估算。每次真实
   * 上游调用（无论 invalid-output / 超时 / 上游失败）都立即记账——两次尝试全败
   * 不得绕过 §9.3 的预算硬顶。
   */
  const accountAttempt = async (usageTokens: number | null, streamedChars: number): Promise<void> => {
    const attemptTokens = usageTokens ?? estimateTokens(promptChars, streamedChars)
    tokens += attemptTokens
    await store.incrementEclosionDaily(ECLOSION_BUDGET_KEY, day, attemptTokens)
  }

  // invalid-output 重试一次（§12 P2：全非法降级重试或失败）。
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, eclosion.timeoutMs)
    // 失败/中止路径没有 usage 回报：按已收流估算已耗费的 token。
    let streamedChars = 0
    try {
      const result = await streamEclosionCompletion({
        fetcher,
        config: eclosion,
        messages,
        signal: controller.signal,
        callbacks: {
          onReasoningDelta: (text) => {
            streamedChars += text.length
          },
          onContentDelta: (text) => {
            streamedChars += text.length
          },
        },
      })
      await accountAttempt(result.usageTokens, streamedChars)
      const parsed = parseWorldLines(result.content, {
        worldDate: day,
        generatedAt: now().toISOString(),
        degraded: snapshot.degraded,
        signalTitles: snapshot.items.map((item) => item.title),
        source: { name: trending.source.label, url: trending.source.url },
      })
      if (parsed.ok) {
        return { ok: true, record: parsed.record, tokens, attempts: attempt }
      }
    } catch (cause) {
      await accountAttempt(null, streamedChars)
      if (cause instanceof Error && cause.name === 'AbortError') {
        return { ok: false, code: 'ai-timeout', detail: timedOut ? 'timeout' : 'aborted' }
      }
      return {
        ok: false,
        code: 'ai-upstream',
        detail: cause instanceof Error ? cause.message : String(cause),
      }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, code: 'invalid-output', detail: 'world-lines-invalid-after-retry' }
}

export interface EnsureWorldParams extends SynthesizeWorldParams {
  day: string
  /** 单飞锁竞争时的等待上限（默认 eclosion.timeoutMs）。 */
  waitDeadlineMs?: number
  /** 锁轮询间隔（默认 250ms；测试调小加速）。 */
  pollMs?: number
  now?: () => Date
}

export type EnsureWorldOutcome =
  | { outcome: 'cache'; record: WorldRecord }
  | { outcome: 'generated'; record: WorldRecord; tokens: number }
  | { outcome: 'failed'; code: WorldSynthesisFailure }

/**
 * 取当日世界：全局缓存 → 单飞锁内懒生成（坑 73 次序：acquire 成功后**再**
 * 补读缓存，防 check-then-act 竞态）→ 写全局键。scheduler 与首个 GET /world
 * 共用本入口，多实例由同一 DataStore 锁去重。
 */
export async function ensureWorldForDay(params: EnsureWorldParams): Promise<EnsureWorldOutcome> {
  const { store, day } = params
  const now = params.now ?? ((): Date => new Date())

  const cached = await store.getEclosionCache(worldGlobalKey(day))
  if (cached !== null) {
    const record = parseStoredWorld(cached, day)
    if (record !== null) return { outcome: 'cache', record }
    // 脏缓存视同缺失，落入重生成。
  }

  const holder = randomUUID()
  const pollMs = params.pollMs ?? 250
  const deadline = now().getTime() + (params.waitDeadlineMs ?? params.eclosion.timeoutMs)
  let acquired = false
  while (true) {
    if (await store.acquireEclosionLock(worldGenLockKey(day), holder, params.eclosion.timeoutMs + 10_000)) {
      acquired = true
      // 抢到锁也可能撞上对端刚写完的缓存：命中即让锁直接服务。
      const fresh = await store.getEclosionCache(worldGlobalKey(day))
      if (fresh !== null) {
        const record = parseStoredWorld(fresh, day)
        if (record !== null) {
          await store.releaseEclosionLock(worldGenLockKey(day), holder).catch(() => {})
          return { outcome: 'cache', record }
        }
      }
      break
    }
    if (now().getTime() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  if (!acquired) {
    // 对端持锁超时未释放：最后再读一次缓存（对端可能恰在截止后写完）。
    const late = await store.getEclosionCache(worldGlobalKey(day))
    if (late !== null) {
      const record = parseStoredWorld(late, day)
      if (record !== null) return { outcome: 'cache', record }
    }
    return { outcome: 'failed', code: 'ai-timeout' }
  }

  try {
    const synthesized = await synthesizeWorld({ ...params, now })
    if (!synthesized.ok) return { outcome: 'failed', code: synthesized.code }
    await store.putEclosionCache(worldGlobalKey(day), JSON.stringify(synthesized.record))
    return { outcome: 'generated', record: synthesized.record, tokens: synthesized.tokens }
  } finally {
    await store.releaseEclosionLock(worldGenLockKey(day), holder).catch(() => {})
  }
}
