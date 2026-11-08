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
/** §10.3：单会话同一标签的**累计**权重增量预算（正负各 6）。 */
export const SESSION_TAG_BUDGET = 6

export interface ApplyFeedbackInput {
  profile: PreferenceProfile
  signal: FeedbackSignal
  /** 该信号指向的风格标签（如壁纸 style）。 */
  targetTags: readonly string[]
  /** 该壁纸的调色板家族键（'dark:low' 等），可选。 */
  targetFamily?: string
  /**
   * 本会话内各标签已累计的权重增量（调用方维护）；缺省=不做累计钳制。
   * §10.3 预算 ±6；`pin` 是显式重申（§10.2 权重 10），不受该预算。
   */
  sessionDeltas?: Readonly<Record<string, number>>
  now: Date
}

/** 应用反馈信号，返回新画像（不可变更新）。 */
export function applyFeedbackSignal(input: ApplyFeedbackInput): PreferenceProfile {
  const weight = SIGNAL_WEIGHTS[input.signal]
  // pin（10）是用户每日重申，按 §10.2 原值计入，不被单信号/会话钳制截成 6
  // （B3 审查）。其余信号先过单信号钳制，再按会话累计预算收口。
  const isPin = input.signal === 'pin'
  const perSignal = isPin
    ? weight
    : Math.max(-PER_SIGNAL_TAG_CLAMP, Math.min(PER_SIGNAL_TAG_CLAMP, weight))
  const tags: Record<string, number> = { ...input.profile.tags }
  for (const tag of input.targetTags) {
    let delta = perSignal
    if (!isPin && input.sessionDeltas !== undefined) {
      const used = input.sessionDeltas[tag] ?? 0
      delta = Math.max(-SESSION_TAG_BUDGET - used, Math.min(SESSION_TAG_BUDGET - used, delta))
    }
    tags[tag] = (tags[tag] ?? 0) + delta
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
