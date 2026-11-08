/**
 * 今日世界载荷校验——客户端副本（AI-GENERATED-APPS-DESIGN §6.2）。
 *
 * 服务端生成时已逐行严格校验（server/src/eclosion/world.ts 的 JSON Lines
 * 闸）；本模块对 GET /api/eclosion/world 的**结构化响应**再校验一次（纵深
 * 防御：不信任任何上行数据，哪怕它来自自家服务）。两侧同口径、独立实现
 * （core 纯 TS、不依赖服务端），一致性由 server/test/eclosion-world.test.ts
 * 动态引入本模块、以同一批正反例字面量比对钉死（照 spec 表读文件先例）。
 *
 * - paletteId 白名单 = 抽象调色板 24 组（PALETTES 去山水 shanshui-*：山水域
 *   2026-09-27 裁决退役、仅旧计划重放）。
 * - accentHue 质量门：WCAG 对比度（light=hsl(h,80%,55%) 对 #fbfdff、
 *   dark=hsl(h,100%,75%) 对 #141b2b，阈值 3）；不合格回落该调色板默认
 *   accent 的色相，再不合格回落 220。
 * - icon 属 Phosphor 白名单（数据卫生；渲染走 AppIcon 确定性徽章 + 世界行
 *   hue 调色相，icon 不驱动渲染——2026-10-02 裁决）。
 * - hint 永不出现在响应里（ADR 27）；本模块遇 hint 字段直接忽略。
 */

import { filterContentText } from '../dynamic/content/filter'
import { PALETTES } from '../dynamic/generative/palettes'

export const ECLOSION_WORLD_MIN_APPS = 6
export const ECLOSION_WORLD_MAX_APPS = 10
export const ECLOSION_WORLD_NAME_MAX_CHARS = 12
export const ECLOSION_WORLD_TAGLINE_MAX_CHARS = 80
export const ECLOSION_WORLD_HEADLINE_MAX_CHARS = 60

export const ECLOSION_WORLD_CATEGORIES = [
  'games',
  'tools',
  'social',
  'creative',
  'news',
  'life',
] as const
export type EclosionWorldCategory = (typeof ECLOSION_WORLD_CATEGORIES)[number]

/** 抽象调色板白名单（PALETTES 派生：剔除带 ridge 色阶的山水组）。 */
export const ECLOSION_WORLD_PALETTE_IDS: readonly string[] = PALETTES.filter(
  (palette) => palette.ridge === undefined,
).map((palette) => palette.id)

const PALETTE_ACCENTS: Readonly<Record<string, string>> = Object.fromEntries(
  PALETTES.filter((palette) => palette.ridge === undefined).map((palette) => [
    palette.id,
    palette.accent,
  ]),
)

/** Phosphor 图标白名单（客户端静态副本；与服务端 world-data.ts 一致性由测试钉死）。 */
export const ECLOSION_WORLD_ICON_WHITELIST: readonly string[] = [
  'Airplane', 'Anchor', 'Atom', 'Barcode', 'Basketball', 'Bell', 'Bird', 'Book', 'BookOpen',
  'Brain', 'Briefcase', 'Calculator', 'Calendar', 'CalendarCheck', 'Camera', 'Cat', 'Chats',
  'ChatCircleText', 'ChefHat', 'Clock', 'Cloud', 'CloudLightning', 'CloudSun', 'Code',
  'Compass', 'Cpu', 'Crown', 'Cube', 'Database', 'Diamond', 'Dog', 'Drop', 'Egg', 'Eye',
  'Feather', 'FileText', 'FilmStrip', 'Fingerprint', 'Fire', 'Fish', 'Flag', 'Flashlight',
  'Flower', 'FlowerLotus', 'FlyingSaucer', 'Football', 'Funnel', 'GameController', 'Gauge',
  'Gavel', 'GearSix', 'Ghost', 'Gift', 'GlobeHemisphereWest', 'GraduationCap', 'GridFour',
  'Guitar', 'Hammer', 'Headphones', 'Heart', 'HighHeel', 'IceCream', 'Joystick', 'Key',
  'Lightbulb', 'Lightning', 'MagicWand', 'Magnet', 'Megaphone', 'Microphone', 'Moon',
  'Mountains', 'MusicNote', 'Newspaper', 'NotePencil', 'NuclearPlant', 'Package', 'PaintBrush',
  'Palette', 'PaperPlane', 'Parachute', 'PawPrint', 'PenNib', 'PianoKeys', 'Pill', 'Planet',
  'Plant', 'PokerChip', 'Presentation', 'PuzzlePiece', 'QrCode', 'Rabbit', 'Rainbow',
  'Rocket', 'Robot', 'SealCheck', 'ShieldCheck', 'ShoppingCart', 'Signpost', 'Skull',
  'Sparkle', 'Speedometer', 'Star', 'StarFour', 'Sun', 'Sunglasses', 'Sword', 'Telescope',
  'Tent', 'TestTube', 'Timer', 'Trophy', 'Truck', 'Umbrella', 'VideoCamera', 'Wallet',
  'Waves', 'Wrench', 'YinYang',
]

/** L0/L1 撞名防线（客户端静态副本；与服务端一致，大小写不敏感比较）。 */
export const ECLOSION_WORLD_NAME_BLOCKLIST: readonly string[] = [
  '计算器', '记事本', '时钟', '文件', '设置', '商店', '应用商店', '终端', '动态面板', '内容面板',
  '搜索', '通知中心', '贪吃蛇', '记忆', '扫雷', 'calculator', 'notes', 'clock', 'files',
  'settings', 'store', 'terminal', 'search', 'snake', 'memory', 'mines', '2048', 'agehaos',
]

// ── 色彩数学（独立实现；口径对齐 dynamic/governance 的对比度定义） ──────────

const SURFACE_LIGHT = '#fbfdff'
const SURFACE_DARK = '#141b2b'
const CONTRAST_UI = 3

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const int = Number.parseInt(match[1], 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

function luminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return 0
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
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
  if (max === min) return null
  const delta = max - min
  let hue: number
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  return Math.round(((hue % 360) + 360) % 360)
}

/** accentHue → 双主题 accent hex（§6.3：只改色相，明度/饱和度固定）。 */
export function eclosionAccentHex(hue: number, theme: 'light' | 'dark'): string {
  return theme === 'light' ? hslToHex(hue, 0.8, 0.55) : hslToHex(hue, 1.0, 0.75)
}

/** accentHue 质量门：双主题 WCAG 对比度 ≥3（UI 构件口径）。 */
export function eclosionAccentHuePassesGate(hue: number): boolean {
  return (
    contrastRatio(eclosionAccentHex(hue, 'light'), SURFACE_LIGHT) >= CONTRAST_UI &&
    contrastRatio(eclosionAccentHex(hue, 'dark'), SURFACE_DARK) >= CONTRAST_UI
  )
}

/** 门不合格回落链：调色板默认 accent 色相 → 220。 */
export function resolveEclosionAccentHue(hue: number, paletteId: string): number {
  if (eclosionAccentHuePassesGate(hue)) return hue
  const fallbackHue = hexHue(PALETTE_ACCENTS[paletteId] ?? '')
  if (fallbackHue !== null && eclosionAccentHuePassesGate(fallbackHue)) return fallbackHue
  return 220
}

// ── 载荷校验 ─────────────────────────────────────────────────────────────────

export interface EclosionWorldApp {
  slug: string
  name: string
  icon: string
  hue: number
  tagline: string
  category: EclosionWorldCategory
  window: { width: number; height: number }
}

export interface EclosionWorldTheme {
  headline: string
  paletteId: string
  accentHue: number
  wallpaper: { engine: string; paletteId: string; mood: string }
}

export interface EclosionWorld {
  worldDate: string
  generatedAt: string
  degraded: boolean
  signalCount: number
  signals: { titles: readonly string[]; sourceName: string; sourceUrl: string }
  theme: EclosionWorldTheme
  apps: readonly EclosionWorldApp[]
}

const WORLD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * UTC 日键（YYYY-MM-DD）。「今日世界」的日界与额度日界同源 = UTC 零点
 * （2026-10-02 裁决：跨日即换新，多时区行为一致）；与服务端 quota.ts 的
 * utcDayKey 同口径。
 */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
const SLUG_PATTERN = /^[a-z0-9-]{2,32}$/
const PALETTE_ID_SET = new Set(ECLOSION_WORLD_PALETTE_IDS)
const ICON_SET = new Set(ECLOSION_WORLD_ICON_WHITELIST)
const NAME_BLOCK_SET = new Set(ECLOSION_WORLD_NAME_BLOCKLIST.map((name) => name.toLowerCase()))
const CATEGORY_SET = new Set<string>(ECLOSION_WORLD_CATEGORIES)
const DEFAULT_WINDOW = { width: 720, height: 480 } as const

function lengthInPoints(text: string): number {
  return Array.from(text).length
}

function truncateByPoints(text: string, max: number): string {
  const points = Array.from(text)
  return points.length <= max ? text : points.slice(0, max).join('')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeTheme(value: unknown): EclosionWorldTheme | null {
  if (!isObject(value)) return null
  const headline = typeof value.headline === 'string' ? value.headline.trim() : ''
  if (headline.length === 0 || lengthInPoints(headline) > ECLOSION_WORLD_HEADLINE_MAX_CHARS) {
    return null
  }
  if (!filterContentText(headline).ok) return null
  const paletteId = typeof value.paletteId === 'string' ? value.paletteId : ''
  if (!PALETTE_ID_SET.has(paletteId)) return null
  const accentHue = value.accentHue
  if (typeof accentHue !== 'number' || !Number.isInteger(accentHue) || accentHue < 0 || accentHue > 359) {
    return null
  }
  let wallpaper = { engine: 'dynamic-desktop', paletteId, mood: 'calm' }
  if (isObject(value.wallpaper)) {
    const engine = typeof value.wallpaper.engine === 'string' ? value.wallpaper.engine.trim() : ''
    const mood = typeof value.wallpaper.mood === 'string' ? value.wallpaper.mood.trim() : ''
    const wpPalette =
      typeof value.wallpaper.paletteId === 'string' && PALETTE_ID_SET.has(value.wallpaper.paletteId)
        ? value.wallpaper.paletteId
        : paletteId
    wallpaper = {
      engine: engine.length > 0 ? truncateByPoints(engine, 24) : wallpaper.engine,
      paletteId: wpPalette,
      mood: mood.length > 0 ? truncateByPoints(mood, 24) : wallpaper.mood,
    }
  }
  return { headline, paletteId, accentHue: resolveEclosionAccentHue(accentHue, paletteId), wallpaper }
}

function sanitizeWindow(value: unknown): { width: number; height: number } {
  if (!isObject(value)) return { ...DEFAULT_WINDOW }
  const width =
    typeof value.width === 'number' && Number.isFinite(value.width) ? Math.round(value.width) : NaN
  const height =
    typeof value.height === 'number' && Number.isFinite(value.height) ? Math.round(value.height) : NaN
  return {
    width: width >= 240 && width <= 1920 ? width : DEFAULT_WINDOW.width,
    height: height >= 160 && height <= 1200 ? height : DEFAULT_WINDOW.height,
  }
}

function sanitizeApp(value: unknown): EclosionWorldApp | null {
  if (!isObject(value)) return null
  const slug = typeof value.slug === 'string' ? value.slug : ''
  if (!SLUG_PATTERN.test(slug)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (name.length === 0 || lengthInPoints(name) > ECLOSION_WORLD_NAME_MAX_CHARS) return null
  if (NAME_BLOCK_SET.has(name.toLowerCase())) return null
  const icon = typeof value.icon === 'string' ? value.icon : ''
  if (!ICON_SET.has(icon)) return null
  const hue = value.hue
  if (typeof hue !== 'number' || !Number.isInteger(hue) || hue < 0 || hue > 359) return null
  const tagline = typeof value.tagline === 'string' ? value.tagline.trim() : ''
  if (tagline.length === 0 || lengthInPoints(tagline) > ECLOSION_WORLD_TAGLINE_MAX_CHARS) {
    return null
  }
  const category = typeof value.category === 'string' ? value.category : ''
  if (!CATEGORY_SET.has(category)) return null
  if (
    !filterContentText(name).ok ||
    !filterContentText(tagline).ok ||
    !filterContentText(`${name} ${tagline}`).ok
  ) {
    return null
  }
  return {
    slug,
    name,
    icon,
    hue,
    tagline,
    category: category as EclosionWorldCategory,
    window: sanitizeWindow(value.window),
  }
}

/**
 * 校验 GET /api/eclosion/world 响应（纵深防御）。整载荷非法返回 null（调用方
 * 静默放弃今日世界，不阻塞桌面——AI 铁律）；apps 数量越界视为整载荷非法
 * （服务端口径：合法 app 行 6–10）。
 */
export function validateEclosionWorld(payload: unknown): EclosionWorld | null {
  if (!isObject(payload)) return null
  if (typeof payload.worldDate !== 'string' || !WORLD_DATE_PATTERN.test(payload.worldDate)) {
    return null
  }
  if (typeof payload.generatedAt !== 'string' || payload.generatedAt.length === 0) return null

  const theme = sanitizeTheme(payload.theme)
  if (theme === null) return null

  if (!Array.isArray(payload.apps)) return null
  const apps: EclosionWorldApp[] = []
  const seenSlugs = new Set<string>()
  for (const raw of payload.apps) {
    const app = sanitizeApp(raw)
    if (app === null || seenSlugs.has(app.slug)) continue
    seenSlugs.add(app.slug)
    apps.push(app)
  }
  if (apps.length < ECLOSION_WORLD_MIN_APPS || apps.length > ECLOSION_WORLD_MAX_APPS) return null

  let titles: readonly string[] = []
  if (isObject(payload.signals) && Array.isArray(payload.signals.titles)) {
    titles = payload.signals.titles
      .filter(
        (title): title is string => typeof title === 'string' && title.length > 0 && title.length <= 160,
      )
      .slice(0, 12) // 数组长度上限（B2 审查：模块定位是不信任任何上行数据）
  }
  const rawSourceName =
    isObject(payload.signals) && typeof payload.signals.sourceName === 'string'
      ? payload.signals.sourceName
      : ''
  const rawSourceUrl =
    isObject(payload.signals) && typeof payload.signals.sourceUrl === 'string'
      ? payload.signals.sourceUrl
      : ''
  // WorldSignals.tsx 把 sourceUrl 直接作 <a href>：仅放行 http(s)（B2 审查）。
  let sourceUrl = ''
  try {
    const parsed = new URL(rawSourceUrl)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') sourceUrl = rawSourceUrl
  } catch {
    sourceUrl = ''
  }
  const signals = {
    titles,
    sourceName: rawSourceName.slice(0, 120),
    sourceUrl,
  }

  return {
    worldDate: payload.worldDate,
    generatedAt: payload.generatedAt,
    degraded: payload.degraded === true,
    signalCount: titles.length,
    signals,
    theme,
    apps,
  }
}
