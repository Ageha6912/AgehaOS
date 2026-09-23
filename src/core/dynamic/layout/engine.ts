import type { ContextSnapshot } from '../types'

/**
 * 桌面编排决策引擎（设计文档 DDS §5.1 域②、§5.3、§5.4，本地规则切片）。
 *
 * 只产出「分组与排序建议」结构：组名走 i18n 键、成员为已安装应用的 appId、
 * 布局档位三选一（单列/双列/宫格）。AI 不直接移动窗口、不卸载应用——采纳
 * 与还原由用户在开始菜单/面板上显式触发（§5.1）。
 */

/** 布局档位（§5.4：离散档位，无自由坐标）。 */
export const LAYOUT_TIERS = ['single', 'double', 'grid'] as const
export type LayoutTier = (typeof LAYOUT_TIERS)[number]

/** 组名只允许落在人工审校的 i18n 键后缀白名单内（铁律 2 / §5.4 文案槽位）。 */
export const LAYOUT_GROUP_KEYS = ['work', 'create', 'tools', 'info'] as const
export type LayoutGroupKey = (typeof LAYOUT_GROUP_KEYS)[number]

export interface LayoutGroup {
  /** 词典键后缀（UI 渲染 dynamic.layout.group.<nameKey>）。 */
  nameKey: LayoutGroupKey
  appIds: string[]
}

export interface LayoutSuggestion {
  /** 组装批次标识（contextVersion 派生），供采纳比对与 desktop.layout.suggested 事件。 */
  layoutId: string
  tier: LayoutTier
  groups: LayoutGroup[]
}

export interface LayoutSuggestionInput {
  snapshot: Pick<ContextSnapshot, 'timePhase' | 'contextVersion'>
  /** 已安装应用 id 可行域（引擎只从这里面挑）。 */
  installedAppIds: readonly string[]
}

/**
 * 永不随机清单内的应用（§5.2 铁律 11）：它们是用户数据入口与系统控制面，
 * 分组/排序建议绝不触碰其位置。
 */
export const LAYOUT_PROTECTED_APP_IDS: readonly string[] = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.settings',
]

/** 本地类别启发式（人工审校的静态映射；未命中的应用进 tools 兜底组）。 */
const APP_CATEGORY: Readonly<Record<string, LayoutGroupKey>> = {
  'com.ageha.calculator': 'tools',
  'com.ageha.samples.clock': 'tools',
  'com.ageha.samples.sticky': 'tools',
  'com.ageha.samples.sketch': 'create',
  'com.ageha.store': 'info',
  'com.ageha.dynamic.panel': 'info',
}

/** 组顺序固定（词典键声明序），保证同输入同输出。 */
const GROUP_ORDER: readonly LayoutGroupKey[] = LAYOUT_GROUP_KEYS

/** 档位规则：应用多 → 宫格，中等 → 双列，其余单列（§5.4 三档）。 */
const GRID_THRESHOLD = 8
const DOUBLE_THRESHOLD = 4

/** 硬上限（§5.5：AI 布局建议 ≤4 组、组内 ≤8 个）。 */
export const MAX_LAYOUT_GROUPS = 4
export const MAX_GROUP_MEMBERS = 8

function categoryOf(appId: string): LayoutGroupKey {
  return APP_CATEGORY[appId] ?? 'tools'
}

function tierFor(eligibleCount: number, phase: ContextSnapshot['timePhase']): LayoutTier {
  if (eligibleCount >= GRID_THRESHOLD) return 'grid'
  if (eligibleCount >= DOUBLE_THRESHOLD) return 'double'
  // 小目录下按时段在单列/双列间取一个确定性档位（清晨聚焦单列，白天双列）。
  if (phase === 'day' || phase === 'morning') return eligibleCount >= 2 ? 'double' : 'single'
  return 'single'
}

/**
 * 组装布局建议：可行域 = 已安装 − 永不随机清单。输出先经自校验（§8.4 过滤
 * 管线的本地项），不合法一律返回 null（无建议）而不是降级成坏结构。
 */
export function buildLayoutSuggestion(input: LayoutSuggestionInput): LayoutSuggestion | null {
  const installed = new Set(input.installedAppIds)
  const eligible = [...installed].filter((id) => !LAYOUT_PROTECTED_APP_IDS.includes(id))
  if (eligible.length === 0) return null

  const buckets = new Map<LayoutGroupKey, string[]>()
  for (const appId of eligible) {
    const category = categoryOf(appId)
    const bucket = buckets.get(category)
    if (bucket) bucket.push(appId)
    else buckets.set(category, [appId])
  }

  // 组内按 appId 稳定排序；空组不产出；组数超限合并进 tools 兜底组。
  const groups: LayoutGroup[] = []
  for (const key of GROUP_ORDER) {
    const members = (buckets.get(key) ?? []).sort((a, b) => a.localeCompare(b))
    if (members.length === 0) continue
    if (groups.length >= MAX_LAYOUT_GROUPS) {
      const fallback = groups.find((group) => group.nameKey === 'tools')
      if (fallback) fallback.appIds.push(...members)
      continue
    }
    groups.push({ nameKey: key, appIds: members.slice(0, MAX_GROUP_MEMBERS) })
  }

  const suggestion: LayoutSuggestion = {
    layoutId: `layout-${input.snapshot.contextVersion}`,
    tier: tierFor(eligible.length, input.snapshot.timePhase),
    groups,
  }
  if (validateLayoutSuggestion(suggestion, input.installedAppIds) !== null) return null
  return suggestion
}

/**
 * 建议 schema 校验（过滤管线；采纳前 UI 侧必须再跑一次——运行时可行域可能
 * 已变化，如应用被卸载）。
 */
export function validateLayoutSuggestion(
  suggestion: LayoutSuggestion,
  installedAppIds: readonly string[],
): string | null {
  if (!LAYOUT_TIERS.includes(suggestion.tier)) return 'invalid-tier'
  if (typeof suggestion.layoutId !== 'string' || suggestion.layoutId.length === 0) {
    return 'invalid-id'
  }
  if (!Array.isArray(suggestion.groups) || suggestion.groups.length === 0) {
    return 'empty-groups'
  }
  if (suggestion.groups.length > MAX_LAYOUT_GROUPS) return 'too-many-groups'
  const installed = new Set(installedAppIds)
  const seen = new Set<string>()
  for (const group of suggestion.groups) {
    if (!LAYOUT_GROUP_KEYS.includes(group.nameKey)) return 'unknown-group-key'
    if (!Array.isArray(group.appIds) || group.appIds.length === 0) return 'empty-group'
    if (group.appIds.length > MAX_GROUP_MEMBERS) return 'oversized-group'
    for (const appId of group.appIds) {
      if (typeof appId !== 'string') return 'invalid-member'
      if (LAYOUT_PROTECTED_APP_IDS.includes(appId)) return 'protected-member'
      if (!installed.has(appId)) return 'uninstalled-member'
      if (seen.has(appId)) return 'duplicate-member'
      seen.add(appId)
    }
  }
  return null
}

/** 采纳前过滤：把建议裁剪到当前仍安装的成员；裁剪后为空则返回 null。 */
export function pruneLayoutSuggestion(
  suggestion: LayoutSuggestion,
  installedAppIds: readonly string[],
): LayoutSuggestion | null {
  const installed = new Set(installedAppIds)
  const groups = suggestion.groups
    .map((group) => ({
      nameKey: group.nameKey,
      appIds: group.appIds.filter((id) => installed.has(id) && !LAYOUT_PROTECTED_APP_IDS.includes(id)),
    }))
    .filter((group) => group.appIds.length > 0)
  const pruned: LayoutSuggestion = { ...suggestion, groups }
  if (groups.length === 0) return null
  if (validateLayoutSuggestion(pruned, installedAppIds) !== null) return null
  return pruned
}
