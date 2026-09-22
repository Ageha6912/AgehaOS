import type { PersonalizationStage, PreferenceProfile } from '../types'

/**
 * 渐进式 ε 阶梯（设计文档 §10.2，铁律 6）。
 * 阶段由画像 + 时间推导（无持久化状态机），14/28 天无信号自动回退。
 */

export const EPSILON_BY_STAGE: Record<PersonalizationStage, number> = {
  'cold-start': 0.5,
  exploration: 0.4,
  convergence: 0.15,
  steady: 0.1,
  pinned: 0,
}

/** 收敛判据：显式信号 ≥10，或总信号 ≥30 且覆盖 ≥5 个风格标签。 */
export const CONVERGE_EXPLICIT = 10
export const CONVERGE_TOTAL = 30
export const CONVERGE_DISTINCT_STYLES = 5
/** 稳态判据：累计有效反馈 ≥20。 */
export const STEADY_TOTAL = 20

const DAY_MS = 24 * 60 * 60 * 1000
/** 收敛期 → 探索期：连续 14 天无反馈（权重减半）。 */
export const STALE_TO_EXPLORATION_DAYS = 14
/** 探索期 → 冷启动：连续 28 天无信号（重置先验）。 */
export const STALE_TO_COLD_START_DAYS = 28

export interface StageInput {
  profile: PreferenceProfile
  now: Date
  /** 是否已固定壁纸（铁律 1：固定期 ε=0）。 */
  stageOverride?: PersonalizationStage
}

export function stageForProfile(input: StageInput): PersonalizationStage {
  if (input.stageOverride) return input.stageOverride
  const { profile } = input
  const distinctStyles = Object.keys(profile.tags).length

  // 时间回退（§10.2 状态机的回退边）。
  if (profile.lastSignalAt) {
    const idleDays = (input.now.getTime() - new Date(profile.lastSignalAt).getTime()) / DAY_MS
    if (idleDays >= STALE_TO_COLD_START_DAYS) return 'cold-start'
    if (idleDays >= STALE_TO_EXPLORATION_DAYS) return 'exploration'
  }

  const converged =
    profile.explicitCount >= CONVERGE_EXPLICIT ||
    (profile.totalCount >= CONVERGE_TOTAL && distinctStyles >= CONVERGE_DISTINCT_STYLES)
  if (!converged) return 'cold-start'
  return profile.totalCount >= STEADY_TOTAL ? 'steady' : 'convergence'
}
