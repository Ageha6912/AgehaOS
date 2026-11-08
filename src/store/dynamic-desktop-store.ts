import { create } from 'zustand'

import { applyFeedbackSignal, emptyProfile } from '@/core/dynamic/feedback/weights'
import {
  LAYOUT_GROUP_KEYS,
  LAYOUT_PROTECTED_APP_IDS,
  LAYOUT_TIERS,
  MAX_GROUP_MEMBERS,
  MAX_LAYOUT_GROUPS,
} from '@/core/dynamic/layout/engine'
import type { LayoutGroup, LayoutSuggestion } from '@/core/dynamic/layout/engine'
import { paletteById } from '@/core/dynamic/generative/palettes'
import type {
  DynamicDesktopPrefs,
  FallbackLevel,
  GenerationOutcome,
  HardwareTier,
  HistoryEntry,
  PreferenceProfile,
  WallpaperPlan,
  WallpaperStyle,
} from '@/core/dynamic/types'

/**
 * 动态桌面状态（设计文档 §3.2）。
 *
 * - 显式偏好与画像按 userId 分键持久化：`agehaos.dynamic-desktop.v1.<userId>`（§2.3），
 *   读档逐字段校验、非法回落默认（脏数据不破坏启动）。
 * - 生成历史/反馈聚合的 VFS 落盘由 `systemDynamicDesktop`（services 层）负责，
 *   本 store 只依赖 core。
 * - 总开关默认关闭；关闭后桌面行为与 v0.1 完全一致（§1.3 原则 4）。
 */

export const DYNAMIC_DESKTOP_KEY_PREFIX = 'agehaos.dynamic-desktop.v1.'

export const DEFAULT_RANDOMNESS = 40

const DEFAULT_PREFS: DynamicDesktopPrefs = {
  // §32（2026-10-01 参考图对齐）：出厂默认壁纸 = 照片基底（WallpaperLayer
  // 常驻渲染），动态桌面默认关闭——开启后面板/建议/生成式 field 照常，
  // field 以覆盖层淡入照片之上。显式保存过偏好的用户不受影响（hydrate
  // 只补缺失字段）。
  enabled: false,
  randomness: DEFAULT_RANDOMNESS,
  hideBadge: false,
  pinned: null,
  blockedStyles: [],
  llmEnhance: false,
}

/** 手动「换一张」节流（§4.6：≥5s 防连点）。 */
export const MANUAL_REFRESH_THROTTLE_MS = 5000

export interface ApplyOutcomeInput {
  outcome: GenerationOutcome
  /** 'world' = 今日世界主题落地（AI-GENERATED-APPS-DESIGN §6.3；非采样路径）。 */
  trigger: 'login' | 'timer' | 'manual' | 'world'
  atMs: number
  tier: HardwareTier
}

interface DynamicDesktopState {
  prefs: DynamicDesktopPrefs
  profile: PreferenceProfile
  userId: string | null
  currentPlan: WallpaperPlan | null
  currentLevel: FallbackLevel
  /** 最近一次决策来源（§6.5 决策日志：local/llm/cache）。 */
  lastDecisionSource: GenerationOutcome['decisionSource'] | null
  /** 生成该壁纸时的硬件档位（§7.1），渲染层据此决定动画。 */
  tier: HardwareTier
  history: HistoryEntry[]
  recentStyles: WallpaperStyle[]
  /** 最近应用的照片 id（会话级，照片域防短期重复）。 */
  recentFieldIds: string[]
  generationOrdinal: number
  lastGenerateAt: number
  generating: boolean
  /** 最近一次布局建议（会话级，刷新即失效；DDS §5.1 域②）。 */
  layoutSuggestion: LayoutSuggestion | null
  /** 用户已采纳的布局（按用户持久化；null = 开始菜单默认视图）。 */
  appliedLayout: LayoutSuggestion | null

  hydrateForUser: (userId: string | null) => void
  setLayoutSuggestion: (suggestion: LayoutSuggestion | null) => void
  applyLayout: (suggestion: LayoutSuggestion) => void
  resetAppliedLayout: () => void
  setEnabled: (enabled: boolean) => void
  setRandomness: (randomness: number) => void
  setHideBadge: (hideBadge: boolean) => void
  setLlmEnhance: (llmEnhance: boolean) => void
  pinCurrent: () => void
  unpin: () => void
  blockCurrentStyle: () => void
  /** 一键回滚：重放历史三元组并转为固定态（§6.5）。 */
  rollbackTo: (entryIndex: number) => void
  applyFeedback: (signal: Parameters<typeof applyFeedbackSignal>[0]['signal'], plan?: WallpaperPlan | null) => void
  applyOutcome: (input: ApplyOutcomeInput) => void
  setHistory: (history: HistoryEntry[]) => void
  setGenerating: (generating: boolean) => void
  /** 登出清空会话级数据（§8.5）；显式偏好与画像按用户保留。 */
  handleLogout: () => void
  /** 清除全部 AI 数据（§6.5 一键恢复默认 + §10.3 清空反馈）。 */
  clearAllData: () => void
}

function storageKey(userId: string): string {
  return `${DYNAMIC_DESKTOP_KEY_PREFIX}${userId}`
}

/**
 * 本会话同标签累计反馈增量（§10.3 ±6 预算，B3 审查）：自定义画像只存总分，
 * 会话预算必须由调用方按「会话开始至今的增量」单独记忆；登出/清空/测试重置
 * 时清空。
 */
const sessionTagDeltas = new Map<string, number>()

function loadPersisted(userId: string): {
  prefs: DynamicDesktopPrefs
  profile: PreferenceProfile
  appliedLayout: LayoutSuggestion | null
} {
  const fallback = { prefs: DEFAULT_PREFS, profile: emptyProfile(), appliedLayout: null }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { prefs?: unknown; profile?: unknown; appliedLayout?: unknown }
    return {
      prefs: sanitizePrefs(parsed.prefs),
      profile: sanitizeProfile(parsed.profile),
      appliedLayout: sanitizeLayout(parsed.appliedLayout),
    }
  } catch {
    return fallback
  }
}

/** 布局建议结构校验（脏数据回落 null；§2.3 逐字段回落）。 */
function sanitizeLayout(value: unknown): LayoutSuggestion | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<LayoutSuggestion>
  if (typeof v.layoutId !== 'string' || v.layoutId.length === 0) return null
  if (typeof v.tier !== 'string' || !LAYOUT_TIERS.includes(v.tier as never)) return null
  if (!Array.isArray(v.groups) || v.groups.length === 0 || v.groups.length > MAX_LAYOUT_GROUPS) {
    return null
  }
  const seen = new Set<string>()
  const groups: LayoutGroup[] = []
  for (const group of v.groups) {
    if (typeof group !== 'object' || group === null) return null
    const g = group as Partial<{ nameKey: unknown; appIds: unknown }>
    if (typeof g.nameKey !== 'string' || !LAYOUT_GROUP_KEYS.includes(g.nameKey as never)) return null
    if (!Array.isArray(g.appIds) || g.appIds.length === 0 || g.appIds.length > MAX_GROUP_MEMBERS) {
      return null
    }
    const appIds: string[] = []
    for (const appId of g.appIds) {
      if (typeof appId !== 'string' || seen.has(appId)) return null
      if (LAYOUT_PROTECTED_APP_IDS.includes(appId)) return null
      seen.add(appId)
      appIds.push(appId)
    }
    groups.push({ nameKey: g.nameKey as LayoutGroup['nameKey'], appIds })
  }
  return { layoutId: v.layoutId, tier: v.tier, groups }
}

function sanitizePrefs(value: unknown): DynamicDesktopPrefs {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS
  const v = value as Partial<DynamicDesktopPrefs>
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_PREFS.enabled,
    randomness:
      typeof v.randomness === 'number' && v.randomness >= 0 && v.randomness <= 100
        ? v.randomness
        : DEFAULT_PREFS.randomness,
    hideBadge: typeof v.hideBadge === 'boolean' ? v.hideBadge : DEFAULT_PREFS.hideBadge,
    pinned: isPlanShape(v.pinned) ? v.pinned : null,
    blockedStyles: Array.isArray(v.blockedStyles)
      ? v.blockedStyles.filter((s): s is string => typeof s === 'string').slice(0, 200)
      : [],
    llmEnhance: typeof v.llmEnhance === 'boolean' ? v.llmEnhance : DEFAULT_PREFS.llmEnhance,
  }
}

function isPlanShape(value: unknown): value is WallpaperPlan {
  if (typeof value !== 'object' || value === null) return false
  const v = value as WallpaperPlan
  return typeof v.seed === 'string' && typeof v.templateId === 'string' && Array.isArray(v.shapes)
}

function sanitizeProfile(value: unknown): PreferenceProfile {
  const base = emptyProfile()
  if (typeof value !== 'object' || value === null) return base
  const v = value as Partial<PreferenceProfile>
  const numbers = (input: unknown): Record<string, number> => {
    if (typeof input !== 'object' || input === null) return {}
    const out: Record<string, number> = {}
    for (const [key, weight] of Object.entries(input)) {
      if (typeof weight === 'number' && Number.isFinite(weight)) out[key] = weight
    }
    return out
  }
  return {
    tags: numbers(v.tags),
    families: numbers(v.families),
    explicitCount: typeof v.explicitCount === 'number' ? v.explicitCount : 0,
    totalCount: typeof v.totalCount === 'number' ? v.totalCount : 0,
    lastSignalAt: typeof v.lastSignalAt === 'string' ? v.lastSignalAt : null,
  }
}

function persist(state: DynamicDesktopState): void {
  if (typeof localStorage === 'undefined' || state.userId === null) return
  try {
    localStorage.setItem(
      storageKey(state.userId),
      JSON.stringify({ prefs: state.prefs, profile: state.profile, appliedLayout: state.appliedLayout }),
    )
  } catch {
    /* quota or privacy mode: stay in memory */
  }
}

export const useDynamicDesktopStore = create<DynamicDesktopState>()((set, get) => ({
  prefs: DEFAULT_PREFS,
  profile: emptyProfile(),
  userId: null,
  currentPlan: null,
  currentLevel: 'L0',
  lastDecisionSource: null,
  tier: 'mid',
  history: [],
  recentStyles: [],
  recentFieldIds: [],
  generationOrdinal: 1,
  lastGenerateAt: 0,
  generating: false,
  layoutSuggestion: null,
  appliedLayout: null,

  hydrateForUser: (userId) => {
    if (userId === null) {
      set({
        userId: null,
        prefs: DEFAULT_PREFS,
        profile: emptyProfile(),
        currentPlan: null,
        generating: false,
        recentFieldIds: [],
        layoutSuggestion: null,
        appliedLayout: null,
      })
      return
    }
    const persisted = loadPersisted(userId)
    set({
      userId,
      prefs: persisted.prefs,
      profile: persisted.profile,
      appliedLayout: persisted.appliedLayout,
      currentPlan: null,
      currentLevel: 'L0',
      generating: false,
      layoutSuggestion: null,
    })
  },

  setLayoutSuggestion: (suggestion) => set({ layoutSuggestion: suggestion }),

  applyLayout: (suggestion) => {
    set({ appliedLayout: suggestion, layoutSuggestion: null })
    persist(get())
  },

  resetAppliedLayout: () => {
    set({ appliedLayout: null })
    persist(get())
  },

  setEnabled: (enabled) => {
    set({ prefs: { ...get().prefs, enabled } })
    persist(get())
  },

  setRandomness: (randomness) => {
    // 钳制 0–100（C1 审查）：越界值本次会话生效、下次 sanitizePrefs 回默认——
    // 表现为设置莫名丢失。
    randomness = Math.min(100, Math.max(0, Math.round(randomness)))
    set({ prefs: { ...get().prefs, randomness } })
    persist(get())
  },

  setHideBadge: (hideBadge) => {
    set({ prefs: { ...get().prefs, hideBadge } })
    persist(get())
  },

  setLlmEnhance: (llmEnhance) => {
    set({ prefs: { ...get().prefs, llmEnhance } })
    persist(get())
  },

  pinCurrent: () => {
    const plan = get().currentPlan
    if (!plan) return
    set({ prefs: { ...get().prefs, pinned: plan } })
    persist(get())
  },

  unpin: () => {
    set({ prefs: { ...get().prefs, pinned: null } })
    persist(get())
  },

  blockCurrentStyle: () => {
    const style = get().currentPlan?.style
    if (!style) return
    const blocked = get().prefs.blockedStyles
    if (blocked.includes(style) || blocked.length >= 200) return
    set({ prefs: { ...get().prefs, blockedStyles: [...blocked, style] } })
    persist(get())
  },

  rollbackTo: (entryIndex) => {
    const entry = get().history[entryIndex]
    if (!entry) return
    set({
      currentPlan: entry.plan,
      currentLevel: entry.level,
      lastDecisionSource: 'cache',
      prefs: { ...get().prefs, pinned: entry.plan },
    })
    persist(get())
  },

  applyFeedback: (signal, plan) => {
    const target = plan ?? get().currentPlan
    // 单风格域（当前唯一启用 gradient-field）里风格权重恒等：构图也要成为
    // 个性化目标（B3 审查），以 `field:<id>` 标签进入同一画像。
    const targetTags: string[] = target ? [target.style] : []
    if (target?.fieldId !== undefined) targetTags.push(`field:${target.fieldId}`)
    const before = get().profile
    const profile = applyFeedbackSignal({
      profile: before,
      signal,
      targetTags,
      targetFamily: familyKeyOf(target),
      sessionDeltas: Object.fromEntries(sessionTagDeltas),
      now: new Date(),
    })
    // 记录本会话实际落地的增量（被预算截断后的值）。
    for (const tag of targetTags) {
      const delta = (profile.tags[tag] ?? 0) - (before.tags[tag] ?? 0)
      if (delta !== 0) sessionTagDeltas.set(tag, (sessionTagDeltas.get(tag) ?? 0) + delta)
    }
    set({ profile })
    persist(get())
  },

  applyOutcome: ({ outcome, trigger, atMs, tier }) => {
    const entry: HistoryEntry = { plan: outcome.plan, level: outcome.level, createdAt: new Date(atMs).toISOString() }
    set((state) => ({
      currentPlan: outcome.plan,
      currentLevel: outcome.level,
      lastDecisionSource: outcome.decisionSource,
      tier,
      lastGenerateAt: atMs,
      generating: false,
      generationOrdinal: state.generationOrdinal + 1,
      recentStyles: [...state.recentStyles, outcome.plan.style].slice(-10),
      recentFieldIds: outcome.plan.fieldId
        ? [...state.recentFieldIds, outcome.plan.fieldId].slice(-6)
        : state.recentFieldIds,
      history: [...state.history, entry].slice(-30),
      // 手动「换一张」是轻负向反馈（§10.2：−1.5）。
      profile:
        trigger === 'manual'
          ? applyFeedbackSignal({
              profile: state.profile,
              signal: 'refresh',
              targetTags: [outcome.plan.style],
              now: new Date(atMs),
            })
          : state.profile,
    }))
    persist(get())
  },

  setHistory: (history) => set({ history }),

  setGenerating: (generating) => set({ generating }),

  handleLogout: () => {
    sessionTagDeltas.clear()
    set({
      userId: null,
      currentPlan: null,
      currentLevel: 'L0',
      lastDecisionSource: null,
      generating: false,
      recentStyles: [],
      recentFieldIds: [],
      generationOrdinal: 1,
      layoutSuggestion: null,
      appliedLayout: null,
    })
  },

  clearAllData: () => {
    sessionTagDeltas.clear()
    if (typeof localStorage !== 'undefined' && get().userId !== null) {
      try {
        localStorage.removeItem(storageKey(get().userId as string))
      } catch {
        /* ignore */
      }
    }
    set({
      prefs: DEFAULT_PREFS,
      profile: emptyProfile(),
      currentPlan: null,
      currentLevel: 'L0',
      lastDecisionSource: null,
      history: [],
      recentStyles: [],
      recentFieldIds: [],
      generationOrdinal: 1,
      layoutSuggestion: null,
      appliedLayout: null,
    })
  },
}))

function familyKeyOf(plan: WallpaperPlan | null | undefined): string | undefined {
  if (!plan) return undefined
  const palette = paletteById(plan.paletteId)
  if (!palette) return undefined
  return `${palette.family.lightness}:${palette.family.saturation}`
}

/** Restores boot defaults and clears persisted per-user data; used between tests. */
export function resetDynamicDesktopStore(): void {
  sessionTagDeltas.clear()
  if (typeof localStorage !== 'undefined') {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(DYNAMIC_DESKTOP_KEY_PREFIX)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  }
  useDynamicDesktopStore.setState({
    prefs: DEFAULT_PREFS,
    profile: emptyProfile(),
    userId: null,
    currentPlan: null,
    currentLevel: 'L0',
    lastDecisionSource: null,
    tier: 'mid',
    history: [],
    recentStyles: [],
    recentFieldIds: [],
    generationOrdinal: 1,
    lastGenerateAt: 0,
    generating: false,
    layoutSuggestion: null,
    appliedLayout: null,
  })
}

/** Seeds an authenticated user without persistence side effects; tests only. */
export function seedDynamicDesktopForTests(userId: string): void {
  useDynamicDesktopStore.setState({ userId })
}
