/**
 * AI 动态桌面共享类型（设计文档 §2–§6）。
 *
 * 本模块及其子模块均为纯 TS、零 React（docs/ARCHITECTURE.md 依赖方向：UI → store → core）。
 * 一切随机源自显式种子（§6.1），产物必须落在人工审校的模板参数空间内。
 */

/** 硬件三档（§7.1）。低档禁动画，中档 30fps 封顶，高档 60fps。 */
export type HardwareTier = 'high' | 'mid' | 'low'

/** 本地时间四相（§2.1）。 */
export type TimePhase = 'morning' | 'day' | 'evening' | 'night'

/** 季节枚举（§2.1）。 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

/** 五类程序化风格（§4.3）。 */
export const WALLPAPER_STYLES = [
  'fluid-gradient',
  'geometric',
  'particle-nebula',
  'mountain-silhouette',
  'grid-wavefield',
] as const
export type WallpaperStyle = (typeof WALLPAPER_STYLES)[number]

/** 五级密度（§4.3，采样值 0.1–0.9）。 */
export const DENSITY_LEVELS = [0.1, 0.3, 0.5, 0.7, 0.9] as const

/** 五级随机度滑杆语义档（§6.3）。 */
export type RandomnessBand = 'fixed' | 'fine' | 'balanced' | 'explore' | 'wild'

/** 个性化阶段（§10.2 ε 阶梯）。 */
export type PersonalizationStage = 'cold-start' | 'exploration' | 'convergence' | 'steady' | 'pinned'

/** 显式/隐式反馈信号（§10.2 权重表）。 */
export type FeedbackSignal =
  | 'pin'
  | 'like'
  | 'dislike'
  | 'block-style'
  | 'report'
  | 'refresh'
  | 'session-skip'
  | 'long-stay'

/** 调色板「家族」：明暗 × 饱和（§10.2 冷启动中性先验的采样维度）。 */
export interface PaletteFamily {
  lightness: 'dark' | 'light'
  saturation: 'high' | 'low'
}

/** 策展调色板（§4.3：24 组，全部人工审校）。 */
export interface Palette {
  id: string
  family: PaletteFamily
  /** 3–4 个渐变 stop，十六进制 #rrggbb，自上而下。 */
  stops: string[]
  /** 主题色（hex），参与品牌主色 ±30° 锚点校验。 */
  accent: string
}

/** 构图参数（§4.3：8 种构图，焦点吸附三分点）。 */
export interface Composition {
  id: string
  /** 焦点位置，单位坐标系 [0,1)。 */
  focus: { x: number; y: number }
  /** 渐变/视差角度（度）。 */
  angle: number
}

/** 画布基本图元（单位坐标 [0,1)，渲染层负责缩放）。 */
export interface PlanShape {
  kind: 'circle' | 'rect'
  x: number
  y: number
  w: number
  h: number
}

/** 生成理由摘要（§6.5 透明机制：不暴露原始信号，仅结构化维度）。 */
export interface GenerationReason {
  /** 参与决策的信号维度，如 ['time:evening', 'theme:dark', 'pref:blue']。 */
  signals: string[]
  palette: string
  motif: WallpaperStyle
}

/** 一张壁纸的完整生成计划：种子三元组唯一寻址（§4.3），可重放。 */
export interface WallpaperPlan {
  seed: string
  generatorVersion: number
  templateId: string
  style: WallpaperStyle
  paletteId: string
  compositionId: string
  /** 密度采样值（DENSITY_LEVELS 之一）。 */
  density: number
  /** 渲染图元（确定性，由种子驱动）。 */
  shapes: PlanShape[]
  /** 动画参数（§4.4 光敏安全：flickerPerSec ≤3；Phase A 仅 slowDrift）。 */
  animation: { kind: 'none' | 'slow-drift'; flickerPerSec: number }
  reason: GenerationReason
  /** 采样分区标签（§6.3 三区配比）。 */
  zone: 'converge' | 'adjacent' | 'far' | 'fallback'
}

/** 兜底链层级（§9.1）。 */
export type FallbackLevel = 'L0' | 'F1' | 'F2' | 'F3'

/** 情境快照（§2.2）：白名单信号的不可变冻结，contextVersion 单调递增并参与种子。 */
export interface ContextSnapshot {
  contextVersion: number
  timePhase: TimePhase
  season: Season
  theme: 'light' | 'dark'
  tier: HardwareTier
  /** 冻结时刻（ISO 字符串，仅用于展示，不参与种子）。 */
  frozenAt: string
}

/** 生成历史条目（§6.5：仅文本元数据，≤30 条 LRU，≤64KB）。 */
export interface HistoryEntry {
  plan: WallpaperPlan
  level: FallbackLevel
  createdAt: string
}

/** 偏好画像（§2.3：只存聚合值，永不存内容）。 */
export interface PreferenceProfile {
  /** 风格标签权重向量（可含负值）。 */
  tags: Record<string, number>
  /** 家族偏好计数（明暗 × 饱和 → 权重）。 */
  families: Record<string, number>
  explicitCount: number
  totalCount: number
  lastSignalAt: string | null
}

/** 用户的动态桌面显式偏好（Settings「动态桌面」section，localStorage 按 userId 分键）。 */
export interface DynamicDesktopPrefs {
  enabled: boolean
  /** 0–100，默认 40（平衡档）。 */
  randomness: number
  /** 隐藏「由 AI 生成」徽标。 */
  hideBadge: boolean
  /** 固定的壁纸（铁律 1：固定即短路整条生成链）。 */
  pinned: WallpaperPlan | null
  /** 屏蔽的风格标签（≤200 条）。 */
  blockedStyles: string[]
}

/** 生成结果：计划 + 兜底层级 + 性能埋点。 */
export interface GenerationOutcome {
  plan: WallpaperPlan
  level: FallbackLevel
  durationMs: number
  decisionSource: 'local' | 'llm' | 'cache'
}
