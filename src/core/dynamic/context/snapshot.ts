import { detectTier } from '../governance/tier'
import type { ContextSnapshot, HardwareTier, Season } from '../types'
import { timePhaseOf } from '../generative/seed'

/**
 * 情境快照（设计文档 §2.2）：白名单信号的不可变冻结。
 * contextVersion 单调递增并参与种子计算——同版本情境的决策可精确复现。
 */

let contextVersionCounter = 0

export function nextContextVersion(): number {
  contextVersionCounter += 1
  return contextVersionCounter
}

/** 测试间隔离。 */
export function resetContextVersion(): void {
  contextVersionCounter = 0
}

/** 季节（北半球近似；月份 3–5 春 / 6–8 夏 / 9–11 秋 / 其余冬）。 */
export function seasonOf(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

export interface SnapshotInput {
  now: Date
  theme: 'light' | 'dark'
  tier?: HardwareTier
  tierSignals?: Parameters<typeof detectTier>[0]
}

export function buildContextSnapshot(input: SnapshotInput): ContextSnapshot {
  const tier = input.tier ?? detectTier(input.tierSignals ?? { hasWebGL2: false })
  const snapshot: ContextSnapshot = {
    contextVersion: nextContextVersion(),
    timePhase: timePhaseOf(input.now.getHours()),
    season: seasonOf(input.now.getMonth() + 1),
    theme: input.theme,
    tier,
    frozenAt: input.now.toISOString(),
  }
  return Object.freeze(snapshot)
}
