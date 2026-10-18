export interface UserRecord {
  id: string
  username: string
  createdAt: string
  updatedAt: string
  passwordHash: string
  /** Role (ADR 20): 'admin' manages the remote catalog (§47 应用审核前置);
   *  absent = 'user'. Bootstrapped via AGEHA_ADMIN_USERNAME. */
  role?: 'user' | 'admin'
  /** Optional profile fields (PRD §12.1 修改昵称/资料); absent = unset. */
  displayName?: string
  email?: string
  /** Avatar as a client-resized data URL (format-whitelisted, ≤64KB chars). */
  avatar?: string
}

export interface SessionRecord {
  token: string
  userId: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** ISO creation time; sessions predating device management omit it. */
  createdAt?: string
  /** Short human-readable device label captured at login. */
  device?: string
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken`)
    this.name = 'UsernameTakenError'
  }
}

/** Storage cap for reported samples; the oldest records are evicted. */
export const MAX_CONTENT_SAMPLES = 500

/**
 * Content sample reported by a user for review (DDS §8.6): anonymous by
 * design (no user/session linkage) and classified by the server-side
 * classifier — `violation` text is rejected by the route and never persisted.
 */
export interface ContentSampleRecord {
  id: string
  text: string
  classification: 'ok' | 'misleading' | 'discomfort'
  createdAt: string
  /**
   * 上报来源（AI-GENERATED-APPS-DESIGN §10 P4）：缺省 = 既有动态面板入口；
   * `'eclosion'` = 羽化应用举报（text=应用名/tagline/query 组合摘要）。
   */
  source?: 'eclosion'
  /**
   * 羽化举报附带的生成内容摘要（HTML 前 2KB，§10）；仅 source='eclosion'
   * 时出现。服务端不做二次清洗——复审面按原文呈现。
   */
  detail?: string
}

/**
 * Persistence boundary for the auth service. Implementations: memory
 * (tests/dev), file (default local dev, survives restarts) and postgres
 * (production; activated by DATABASE_URL).
 */
export interface DataStore {
  init(): Promise<void>
  close(): Promise<void>
  findUserByUsername(username: string): Promise<UserRecord | null>
  findUserById(id: string): Promise<UserRecord | null>
  /** Rejects with UsernameTakenError when the username already exists. */
  createUser(user: UserRecord): Promise<void>
  /** Persists profile/hash changes for an existing user. */
  updateUser(user: UserRecord): Promise<void>
  createSession(session: SessionRecord): Promise<void>
  findSession(token: string): Promise<SessionRecord | null>
  deleteSession(token: string): Promise<void>
  /** Deletes sessions whose expiresAt is before `now`; returns count. */
  pruneExpiredSessions(now: number): Promise<number>
  /** Revokes every session of the user except `keepToken`; returns count. */
  deleteSessionsForUserExcept(userId: string, keepToken: string): Promise<number>
  /** All live sessions of the user (device management, PRD §12.1/§35). */
  findSessionsForUser(userId: string): Promise<SessionRecord[]>
  /** Per-user sync-blob domain (PRD §35 用户配置同步 + 云文件快照); null when unset. */
  getSyncData(userId: string, domain: string): Promise<string | null>
  /** Upserts one sync domain; domain names and capacity are enforced by the route. */
  putSyncData(userId: string, domain: string, data: string): Promise<void>
  /** Admin-published remote store catalog (ADR 20); null = fall back to built-in. */
  getAppCatalog(): Promise<string | null>
  /** Replaces the published catalog (single JSON blob, validated by the route). */
  putAppCatalog(catalogJson: string): Promise<void>
  /** Stores one reported sample (DDS §8.6); keeps newest MAX_CONTENT_SAMPLES. */
  createContentSample(sample: ContentSampleRecord): Promise<void>
  /** All stored samples, newest first (admin review listing). */
  listContentSamples(): Promise<ContentSampleRecord[]>
  /** Deletes one sample by id (admin disposition); false when the id is unknown. */
  deleteContentSample(id: string): Promise<boolean>
  /**
   * 羽化每日计数（AI-GENERATED-APPS-DESIGN §9.3：按用户按日生成额度 + 全局
   * 每日 token 预算）。key 由调用方（server/src/eclosion/quota.ts）构造——
   * `usage:<userId>:<kind>` 或 `budget:tokens`；day 为 UTC `YYYY-MM-DD`。
   * 返回自增后的值（原子 upsert 自增）。
   */
  incrementEclosionDaily(key: string, day: string, by: number): Promise<number>
  /** 读取某日计数（缺省 0）。 */
  getEclosionDaily(key: string, day: string): Promise<number>
  /**
   * 羽化 L1 全局 HTML 缓存（§9.2 共享缓存：第一个用户触发生成，其余直接
   * 拿缓存且不耗额度）。key = (kind, specId, specVersion, model) 复合串。
   */
  getEclosionCache(key: string): Promise<string | null>
  putEclosionCache(key: string, html: string): Promise<void>
  /**
   * 羽化单飞锁（§9.2）：同一 key 同一时间只生成一次。TTL 内仅持有者生成；
   * 过期后可被抢占（崩溃自愈）。Redis SET NX PX 推迟 P2 多实例（决策：本期
   * 单实例落 DataStore 锁记录）。
   */
  acquireEclosionLock(key: string, holder: string, ttlMs: number): Promise<boolean>
  /** 仅 holder 匹配时释放（不误删他人接手后的锁）。 */
  releaseEclosionLock(key: string, holder: string): Promise<void>
  /**
   * 浏览器代理的站点 Cookie 罐（2026-10-18 档 ②）：按用户隔离的单 JSON blob
   * （结构由 browse/cookie-jar.ts 定义；键 = userId）。null = 从未保存。
   * cookie 值仅存服务端——永不回传浏览器、永不进日志。
   */
  getBrowseJar(userId: string): Promise<string | null>
  putBrowseJar(userId: string, payload: string): Promise<void>
  clearBrowseJar(userId: string): Promise<void>
}
