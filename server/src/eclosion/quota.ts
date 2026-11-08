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

/**
 * 单次生成在全局 token 预算上的原子预占额度（A3 审查）：取单次输出上限与
 * 预算总额的较小值——预算本身小于单次上限时（测试/小额度部署）仍能预占，
 * 避免「永远预占不到」的死锁；真实用量在生成结束后多退少补。
 */
export function budgetReservationTokens(
  maxTokens: number,
  dailyTokenBudget: number,
  used = 0,
): number {
  const remaining = dailyTokenBudget - used
  return Math.max(1, Math.min(maxTokens, remaining))
}

/**
 * 日计数的预占租约：预留成功时已计入 `amount`，随后二选一——
 * 未发生真实生成 → `release()` 全额退还；发生真实生成 → `settle(actual)`
 * 按实际用量多退少补（跨 UTC 零点时旧日退还、新日计入）。
 */
export interface EclosionQuotaLease {
  readonly key: string
  readonly day: string
  readonly amount: number
  release(): Promise<void>
  settle(actual: number, billingDay?: string): Promise<void>
}

class DataStoreQuotaLease implements EclosionQuotaLease {
  private done = false

  constructor(
    private readonly store: DataStore,
    readonly key: string,
    readonly day: string,
    readonly amount: number,
  ) {}

  async release(): Promise<void> {
    if (this.done) return
    this.done = true
    await this.store.incrementEclosionDaily(this.key, this.day, -this.amount)
  }

  async settle(actual: number, billingDay: string = this.day): Promise<void> {
    if (this.done) return
    this.done = true
    const delta = actual - this.amount
    if (billingDay === this.day) {
      if (delta !== 0) await this.store.incrementEclosionDaily(this.key, this.day, delta)
      return
    }
    await this.store.incrementEclosionDaily(this.key, this.day, -this.amount)
    if (actual !== 0) await this.store.incrementEclosionDaily(this.key, billingDay, actual)
  }
}

/**
 * 原子预留日计数（§9.3）：预占失败返回 null（调用方按额度耗尽处理）。
 * 读-判-写由 DataStore 的 `reserveEclosionDaily` 保证原子，并发请求在
 * `used = limit - 1` 时只有一个能拿到租约。
 */
export async function reserveEclosionQuota(
  store: DataStore,
  key: string,
  day: string,
  limit: number,
  amount: number,
): Promise<EclosionQuotaLease | null> {
  const { reserved } = await store.reserveEclosionDaily(key, day, limit, amount)
  return reserved ? new DataStoreQuotaLease(store, key, day, amount) : null
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
