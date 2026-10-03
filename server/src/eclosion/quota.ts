import type { DataStore } from '../store/types'

/**
 * 羽化额度域（AI-GENERATED-APPS-DESIGN §9.3 成本与滥用控制）：
 * - 按用户每日生成次数（basic 10 / today 30 / imagine 20，本期仅 basic 开放）。
 * - 全局每日 token 预算（AGEHA_ECLOSION_DAILY_TOKEN_BUDGET，默认 2M）——
 *   admin 不受个人额度限制，但计入全局预算。
 * - 计数只在**真实上游生成已发起**时递增（缓存命中不耗额度，§9.2）：断开/
 *   超时/上游失败/invalid-output 的尝试同样计入——内容可能已部分交付，失败
 *   收尾不得免单。
 * - 日界 = UTC 零点；resetAtIso = 下一个 UTC 零点。
 */

export interface EclosionKindQuota {
  used: number
  limit: number
}

export interface EclosionQuotaSnapshot {
  configured: boolean
  quotas: { basic: EclosionKindQuota; today: EclosionKindQuota; imagine: EclosionKindQuota }
  resetAtIso: string
}

/** 各 kind 的个人每日上限（设计 §9.3 默认值）。 */
export const ECLOSION_DAILY_LIMITS = {
  basic: 10,
  today: 30,
  imagine: 20,
} as const

/** 全局 token 预算的 DataStore 计数键。 */
export const ECLOSION_BUDGET_KEY = 'budget:tokens'

/** 个人按 kind 的 DataStore 计数键。 */
export function eclosionUsageKey(userId: string, kind: string): string {
  return `usage:${userId}:${kind}`
}

/** UTC 日键（YYYY-MM-DD）：日界与 resetAt 同源。 */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** 下一个 UTC 零点（额度重置时刻）。 */
export function nextUtcMidnightIso(now: Date = new Date()): string {
  const next = new Date(now)
  next.setUTCHours(24, 0, 0, 0)
  return next.toISOString()
}

/** GET /api/eclosion/quota 的快照（未配置 Key 时 configured=false，开关置灰依据）。 */
export async function readQuotaSnapshot(
  store: DataStore,
  userId: string,
  configured: boolean,
  now: Date = new Date(),
): Promise<EclosionQuotaSnapshot> {
  const day = utcDayKey(now)
  const [basic, today, imagine] = await Promise.all([
    store.getEclosionDaily(eclosionUsageKey(userId, 'basic'), day),
    store.getEclosionDaily(eclosionUsageKey(userId, 'today'), day),
    store.getEclosionDaily(eclosionUsageKey(userId, 'imagine'), day),
  ])
  return {
    configured,
    quotas: {
      basic: { used: basic, limit: ECLOSION_DAILY_LIMITS.basic },
      today: { used: today, limit: ECLOSION_DAILY_LIMITS.today },
      imagine: { used: imagine, limit: ECLOSION_DAILY_LIMITS.imagine },
    },
    resetAtIso: nextUtcMidnightIso(now),
  }
}
