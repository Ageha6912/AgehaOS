import type { FeedbackSignal, PreferenceProfile } from '../types'

/**
 * 反馈权重（设计文档 §10.2 统一表）与防极化（§10.3）。
 * 只存风格标签与聚合计数，永不存内容（铁律 10）。
 */

/** §10.2 权重表。 */
export const SIGNAL_WEIGHTS: Record<FeedbackSignal, number> = {
  pin: 10,
  like: 3,
  dislike: -4,
  'block-style': -8,
  report: -5,
  refresh: -1.5,
  'session-skip': -1,
  'long-stay': 1,
}

const EXPLICIT_SIGNALS: ReadonlySet<FeedbackSignal> = new Set([
  'pin',
  'like',
  'dislike',
  'block-style',
  'report',
  'refresh',
])

/** §10.3：单会话内同一标签权重增量上限 ±6（无会话追踪时按单信号增量钳制）。 */
export const PER_SIGNAL_TAG_CLAMP = 6

export interface ApplyFeedbackInput {
  profile: PreferenceProfile
  signal: FeedbackSignal
  /** 该信号指向的风格标签（如壁纸 style）。 */
  targetTags: readonly string[]
  /** 该壁纸的调色板家族键（'dark:low' 等），可选。 */
  targetFamily?: string
  now: Date
}

/** 应用反馈信号，返回新画像（不可变更新）。 */
export function applyFeedbackSignal(input: ApplyFeedbackInput): PreferenceProfile {
  const weight = SIGNAL_WEIGHTS[input.signal]
  const clamped = Math.max(-PER_SIGNAL_TAG_CLAMP, Math.min(PER_SIGNAL_TAG_CLAMP, weight))
  const tags: Record<string, number> = { ...input.profile.tags }
  for (const tag of input.targetTags) {
    tags[tag] = (tags[tag] ?? 0) + clamped
  }
  const families: Record<string, number> = { ...input.profile.families }
  if (input.targetFamily) {
    families[input.targetFamily] = (families[input.targetFamily] ?? 0) + (weight >= 0 ? 1 : -1)
  }
  return {
    tags,
    families,
    explicitCount: input.profile.explicitCount + (EXPLICIT_SIGNALS.has(input.signal) ? 1 : 0),
    totalCount: input.profile.totalCount + 1,
    lastSignalAt: input.now.toISOString(),
  }
}

/** 清空全部反馈（§10.3「清空我的反馈数据」，回到冷启动先验）。 */
export function emptyProfile(): PreferenceProfile {
  return { tags: {}, families: {}, explicitCount: 0, totalCount: 0, lastSignalAt: null }
}
