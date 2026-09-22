import { buildWallpaperPlan, COMPOSITIONS } from '../generative/templates'
import { compatiblePalettes } from '../generative/palettes'
import { deriveDomainSeed, mulberry32 } from '../generative/seed'
import type {
  ContextSnapshot,
  PreferenceProfile,
  RandomnessBand,
  WallpaperPlan,
  WallpaperStyle,
} from '../types'
import { DENSITY_LEVELS, WALLPAPER_STYLES } from '../types'
import { EPSILON_BY_STAGE, stageForProfile } from '../feedback/epsilon'

/**
 * 规则引擎（设计文档 §4.2、§6.3、§6.4）：纯函数，P95 ≤10ms 预算（§7.2）。
 * 固定权重融合：时间相位 0.4 / 主题 0.25 / 偏好 0.25 / 季节 0.1（写死为常量，保证可测）。
 */

export interface SliderBandConfig {
  band: RandomnessBand
  /** 三区配比（收敛/相邻探索/远探索）。 */
  zones: { converge: number; adjacent: number; far: number }
  /** 滑杆档位的 ε 上限（与 §10.2 阶梯取「更保守者」）。 */
  epsilonCap: number
}

/** 五级滑杆（§6.3 表）。 */
export function sliderBand(randomness: number): SliderBandConfig {
  if (randomness <= 0) return { band: 'fixed', zones: { converge: 1, adjacent: 0, far: 0 }, epsilonCap: 0 }
  if (randomness <= 25) return { band: 'fine', zones: { converge: 0.9, adjacent: 0.1, far: 0 }, epsilonCap: 0.1 }
  if (randomness <= 60) return { band: 'balanced', zones: { converge: 0.7, adjacent: 0.2, far: 0.1 }, epsilonCap: 0.15 }
  if (randomness <= 90) return { band: 'explore', zones: { converge: 0.4, adjacent: 0.4, far: 0.2 }, epsilonCap: 0.4 }
  return { band: 'wild', zones: { converge: 0.1, adjacent: 0.3, far: 0.6 }, epsilonCap: 0.5 }
}

/** §10.2 冷启动中性先验（深色低饱和 40% / 浅色低饱和 25% / 深色高饱和 20% / 浅色高饱和 15%）。 */
export const NEUTRAL_FAMILY_PRIOR: Record<string, number> = {
  'dark:low': 0.4,
  'light:low': 0.25,
  'dark:high': 0.2,
  'light:high': 0.15,
}

const familyKey = (lightness: 'dark' | 'light', saturation: 'high' | 'low') => `${lightness}:${saturation}`

function familyWeights(snapshot: ContextSnapshot, profile: PreferenceProfile): Record<string, number> {
  const hasData = profile.totalCount > 0 && Object.keys(profile.families).length > 0
  const base = hasData ? { ...profile.families } : { ...NEUTRAL_FAMILY_PRIOR }
  // §10.2：22:00 后向深色系倾斜（时间相位权重 0.4 的体现之一）。
  if (snapshot.timePhase === 'night') {
    for (const key of Object.keys(base)) {
      base[key] = base[key] * (key.startsWith('dark') ? 1.25 : 0.8)
    }
  }
  return base
}

function weightedPick<T>(items: readonly T[], weightOf: (item: T) => number, rng: () => number): T {
  const total = items.reduce((sum, item) => sum + Math.max(weightOf(item), 0), 0)
  if (total <= 0) return items[Math.floor(rng() * items.length)] as T
  let roll = rng() * total
  for (const item of items) {
    roll -= Math.max(weightOf(item), 0)
    if (roll <= 0) return item
  }
  return items[items.length - 1] as T
}

/** §10.3 防极化：单标签权重占比上限 35%（超限截断，超额均摊到未截断标签）。 */
export const MAX_TAG_SHARE = 0.35

export function cappedStyleWeights(profile: PreferenceProfile): Record<string, number> {
  const entries = Object.entries(profile.tags).filter(([, w]) => w > 0)
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  if (entries.length === 0 || total <= 0) return {}
  const weights: Record<string, number> = {}
  const under: Array<[string, number]> = []
  let excess = 0
  for (const [tag, w] of entries) {
    if (w / total > MAX_TAG_SHARE) {
      const capped = total * MAX_TAG_SHARE
      excess += w - capped
      weights[tag] = capped
    } else {
      weights[tag] = w
      under.push([tag, w])
    }
  }
  if (excess > 0 && under.length > 0) {
    const underTotal = under.reduce((sum, [, w]) => sum + w, 0)
    for (const [tag, w] of under) {
      weights[tag] = w + (excess * w) / underTotal
    }
  }
  return weights
}

function pickStyle(
  zone: WallpaperPlan['zone'],
  profile: PreferenceProfile,
  allowed: readonly WallpaperStyle[],
  rng: () => number,
): WallpaperStyle {
  if (allowed.length === 0) return WALLPAPER_STYLES[0]
  if (zone !== 'converge') return allowed[Math.floor(rng() * allowed.length)]
  const weights = cappedStyleWeights(profile)
  if (Object.keys(weights).length === 0) {
    // 冷启动收敛区：无偏好 → 风格在可行集合内均匀，家族先验作用于调色板选择。
    return allowed[Math.floor(rng() * allowed.length)]
  }
  return weightedPick(
    allowed,
    (style) => weights[style] ?? 0.05,
    rng,
  )
}

function pickPalette(
  style: WallpaperStyle,
  snapshot: ContextSnapshot,
  profile: PreferenceProfile,
  rng: () => number,
): string {
  // §2.1 主题过滤（权重 0.25 的硬性部分）：深色主题只采深色家族，浅色反之。
  const themeLightness = snapshot.theme === 'dark' ? 'dark' : 'light'
  let compatible = compatiblePalettes(style).filter((p) => p.family.lightness === themeLightness)
  if (compatible.length === 0) compatible = compatiblePalettes(style)
  const families = familyWeights(snapshot, profile)
  const palette = weightedPick(compatible, (p) => {
    const key = familyKey(p.family.lightness, p.family.saturation)
    return families[key] ?? 0.05
  }, rng)
  return palette.id
}

/** §6.4 ③：最近 10 次风格 Shannon 熵（bits）。 */
export function styleEntropy(recentStyles: readonly WallpaperStyle[]): number {
  if (recentStyles.length === 0) return Number.POSITIVE_INFINITY
  const counts = new Map<string, number>()
  for (const style of recentStyles) counts.set(style, (counts.get(style) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / recentStyles.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/** §6.4：熵 <1.5 bits 强制全局采样。 */
export const MIN_STYLE_ENTROPY_BITS = 1.5
/** §6.4 ②：每 7 次生成含 1 次强制探索位。 */
export const FORCED_EXPLORATION_PERIOD = 7

export interface DecideInput {
  sessionSeed: string
  contextVersion: number
  /** 重采样序号（质量门不过时递增，推进种子）。 */
  attempt: number
  snapshot: ContextSnapshot
  blockedStyles: readonly string[]
  randomness: number
  profile: PreferenceProfile
  /** 会话内生成序号（从 1 起）。 */
  generationOrdinal: number
  recentStyles: readonly WallpaperStyle[]
  /** 个性化阶段覆盖（测试注入）；缺省由画像推导。 */
  stageOverride?: Parameters<typeof stageForProfile>[0]['stageOverride']
}

export interface DecideResult {
  plan: WallpaperPlan
  zone: WallpaperPlan['zone']
}

export function decideWallpaper(input: DecideInput): DecideResult {
  const { snapshot, profile } = input
  const domainSeed = deriveDomainSeed(input.sessionSeed, 'wallpaper', input.attempt, input.contextVersion)
  const rng = mulberry32(domainSeed)
  const band = sliderBand(input.randomness)
  if (band.band === 'fixed') {
    // 固定档不生成新结果；由调用方短路，此处给确定性兜底（理论不可达）。
    const plan = buildWallpaperPlan({
      seed: domainSeed,
      style: 'fluid-gradient',
      paletteId: 'midnight-ink',
      compositionId: COMPOSITIONS[0].id,
      density: DENSITY_LEVELS[0],
      zone: 'fallback',
      reason: { signals: ['band:fixed'], palette: 'midnight-ink', motif: 'fluid-gradient' },
    })
    return { plan, zone: 'fallback' }
  }

  const stage = stageForProfile({ profile, now: new Date(), stageOverride: input.stageOverride })
  const epsilon = Math.min(EPSILON_BY_STAGE[stage], band.epsilonCap)

  // 可行域：风格库减屏蔽名单，且风格在当前主题下至少有一个可行调色板（§2.1 主题过滤）。
  const themeLightness = snapshot.theme === 'dark' ? 'dark' : 'light'
  const allowed = WALLPAPER_STYLES.filter(
    (s) =>
      !input.blockedStyles.includes(s) &&
      compatiblePalettes(s).some((p) => p.family.lightness === themeLightness),
  )

  // 三区配比。
  const roll = rng()
  let zone: WallpaperPlan['zone'] =
    roll < band.zones.converge ? 'converge' : roll < band.zones.converge + band.zones.adjacent ? 'adjacent' : 'far'

  // ε 叠加（§6.3）：以 ε 概率向探索方向推进一档。
  if (rng() < epsilon) zone = zone === 'converge' ? 'adjacent' : 'far'
  // §6.4 ②：每 7 次生成 1 次强制探索位。
  if (input.generationOrdinal % FORCED_EXPLORATION_PERIOD === 0) zone = 'far'
  // §6.4 ③：熵保底。
  if (styleEntropy(input.recentStyles.slice(-10)) < MIN_STYLE_ENTROPY_BITS) zone = 'far'

  const style = pickStyle(zone, profile, allowed, rng)
  const paletteId = pickPalette(style, snapshot, profile, rng)
  const composition = COMPOSITIONS[Math.floor(rng() * COMPOSITIONS.length)]
  const density = DENSITY_LEVELS[Math.floor(rng() * DENSITY_LEVELS.length)]

  const plan = buildWallpaperPlan({
    seed: domainSeed,
    style,
    paletteId,
    compositionId: composition.id,
    density,
    zone,
    reason: {
      signals: [
        `time:${snapshot.timePhase}`,
        `theme:${snapshot.theme}`,
        `season:${snapshot.season}`,
        `stage:${stage}`,
        `band:${band.band}`,
      ],
      palette: paletteId,
      motif: style,
    },
  })
  return { plan, zone }
}
