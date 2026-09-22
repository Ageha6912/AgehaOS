import { create } from 'zustand'

import { applyFeedbackSignal, emptyProfile } from '@/core/dynamic/feedback/weights'
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
  enabled: false,
  randomness: DEFAULT_RANDOMNESS,
  hideBadge: false,
  pinned: null,
  blockedStyles: [],
}

/** 手动「换一张」节流（§4.6：≥5s 防连点）。 */
export const MANUAL_REFRESH_THROTTLE_MS = 5000

export interface ApplyOutcomeInput {
  outcome: GenerationOutcome
  trigger: 'login' | 'timer' | 'manual'
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
  generationOrdinal: number
  lastGenerateAt: number
  generating: boolean

  hydrateForUser: (userId: string | null) => void
  setEnabled: (enabled: boolean) => void
  setRandomness: (randomness: number) => void
  setHideBadge: (hideBadge: boolean) => void
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

function loadPersisted(userId: string): { prefs: DynamicDesktopPrefs; profile: PreferenceProfile } {
  const fallback = { prefs: DEFAULT_PREFS, profile: emptyProfile() }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { prefs?: unknown; profile?: unknown }
    return { prefs: sanitizePrefs(parsed.prefs), profile: sanitizeProfile(parsed.profile) }
  } catch {
    return fallback
  }
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
      JSON.stringify({ prefs: state.prefs, profile: state.profile }),
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
  generationOrdinal: 1,
  lastGenerateAt: 0,
  generating: false,

  hydrateForUser: (userId) => {
    if (userId === null) {
      set({ userId: null, prefs: DEFAULT_PREFS, profile: emptyProfile(), currentPlan: null, generating: false })
      return
    }
    const persisted = loadPersisted(userId)
    set({
      userId,
      prefs: persisted.prefs,
      profile: persisted.profile,
      currentPlan: null,
      currentLevel: 'L0',
      generating: false,
    })
  },

  setEnabled: (enabled) => {
    set({ prefs: { ...get().prefs, enabled } })
    persist(get())
  },

  setRandomness: (randomness) => {
    set({ prefs: { ...get().prefs, randomness } })
    persist(get())
  },

  setHideBadge: (hideBadge) => {
    set({ prefs: { ...get().prefs, hideBadge } })
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
    const profile = applyFeedbackSignal({
      profile: get().profile,
      signal,
      targetTags: target ? [target.style] : [],
      targetFamily: familyKeyOf(target),
      now: new Date(),
    })
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
    set({ userId: null, currentPlan: null, currentLevel: 'L0', lastDecisionSource: null, generating: false, recentStyles: [], generationOrdinal: 1 })
  },

  clearAllData: () => {
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
      generationOrdinal: 1,
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
    generationOrdinal: 1,
    lastGenerateAt: 0,
    generating: false,
  })
}

/** Seeds an authenticated user without persistence side effects; tests only. */
export function seedDynamicDesktopForTests(userId: string): void {
  useDynamicDesktopStore.setState({ userId })
}
