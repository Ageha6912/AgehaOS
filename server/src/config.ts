import { fileURLToPath } from 'node:url'
import path from 'node:path'

export type StoreKind = 'memory' | 'file' | 'postgres'

export interface AiProxyConfig {
  /** Upstream provider key; null = proxy disabled (503, client falls back). */
  apiKey: string | null
  baseUrl: string
  model: string
  timeoutMs: number
}

/**
 * 羽化模式专用上游（AI-GENERATED-APPS-DESIGN §9.1/§9.3）：独立于内容面板的
 * AGEHA_AI_* 配置，未设置的项回退 AGEHA_AI_*；API Key 两者皆空 → null
 * （/api/eclosion/generate 503 ai-not-configured，L1 走原生兜底）。
 * 密钥只存在服务端，永不进前端构建、禁用 VITE_ 前缀。
 */
export interface EclosionConfig {
  apiKey: string | null
  baseUrl: string
  model: string
  /** 推理模型压低思考量（§5.1）；空 = 端点不支持，不发送该字段。 */
  reasoningEffort: string | null
  maxTokens: number
  timeoutMs: number
  /** 全局每日 token 预算（§9.3 成本护栏）。 */
  dailyTokenBudget: number
  /** 今日世界热点源 URL（§6.1 默认 GitHub Trending RSS daily/all.xml）。 */
  trendingUrl: string
  /** 热点缓存 TTL（§6.1 默认 6h；内存 + DataStore 双层）。 */
  trendingTtlMs: number
  /** 热点抓取超时（fetch 中止上限）。 */
  trendingTimeoutMs: number
  /** 今日世界定时生成（§9.2：启动检查一次 + 每 interval 查 UTC 日跨日即生成）。 */
  worldSchedulerEnabled: boolean
  /** 查日间隔（默认 10 分钟）。 */
  worldSchedulerIntervalMs: number
}

export interface ServerConfig {
  host: string
  port: number
  store: StoreKind
  /** File-store data directory (file store only). */
  dataDir: string
  /** Postgres connection string (postgres store only). */
  databaseUrl: string | null
  /** Redis connection string: enables the shared rate-limit store (multi-instance). */
  redisUrl: string | null
  sessionTtlMs: number
  cookieSecure: boolean
  logLevel: string
  /**
   * Admin bootstrap (ADR 20): the user registered under this username is
   * promoted to role=admin at register time and on every boot (idempotent,
   * works retroactively on existing databases). Null = no admin exists.
   */
  adminUsername: string | null
  rateLimit: {
    loginMax: number
    registerMax: number
    windowMs: number
  }
  /** Extra allowed CSRF origins beyond the request's own host. */
  allowedOrigins: string[]
  ai: AiProxyConfig
  eclosion: EclosionConfig
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no')
}

function listEnv(name: string): string[] {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/**
 * Environment-driven configuration (12-factor style). Every value can be
 * overridden by buildApp() options, which is what tests use.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development'
  const databaseUrl = env.DATABASE_URL?.trim() || null
  const redisUrl = env.AGEHA_REDIS_URL?.trim() || null
  const storeEnv = env.AGEHA_STORE?.trim()
  const store: StoreKind =
    storeEnv === 'memory' || storeEnv === 'file' || storeEnv === 'postgres'
      ? storeEnv
      : databaseUrl
        ? 'postgres'
        : 'file'

  return {
    host: env.AGEHA_HOST ?? '127.0.0.1',
    port: intEnv(env, 'AGEHA_PORT', 8787),
    store,
    dataDir: env.AGEHA_DATA_DIR
      ? path.resolve(env.AGEHA_DATA_DIR)
      : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'),
    databaseUrl,
    redisUrl,
    sessionTtlMs: intEnv(env, 'AGEHA_SESSION_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    cookieSecure: nodeEnv === 'production',
    logLevel: env.AGEHA_LOG_LEVEL ?? 'info',
    adminUsername: env.AGEHA_ADMIN_USERNAME?.trim() || null,
    rateLimit: {
      loginMax: intEnv(env, 'AGEHA_RATE_LIMIT_LOGIN_MAX', 10),
      registerMax: intEnv(env, 'AGEHA_RATE_LIMIT_REGISTER_MAX', 20),
      windowMs: intEnv(env, 'AGEHA_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    },
    allowedOrigins: listEnv('AGEHA_ALLOWED_ORIGINS'),
    ai: {
      apiKey: env.AGEHA_AI_API_KEY?.trim() || null,
      baseUrl: env.AGEHA_AI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      model: env.AGEHA_AI_MODEL?.trim() || 'gpt-4o-mini',
      timeoutMs: intEnv(env, 'AGEHA_AI_TIMEOUT_MS', 2000),
    },
    // AGEHA_ECLOSION_* 逐项回退 AGEHA_AI_*（设计 §9.1 配置示例；Key 两者皆空 → null）。
    eclosion: {
      apiKey:
        env.AGEHA_ECLOSION_API_KEY?.trim() ||
        env.AGEHA_AI_API_KEY?.trim() ||
        null,
      baseUrl:
        env.AGEHA_ECLOSION_BASE_URL?.trim() ||
        env.AGEHA_AI_BASE_URL?.trim() ||
        'https://api.openai.com/v1',
      model:
        env.AGEHA_ECLOSION_MODEL?.trim() ||
        env.AGEHA_AI_MODEL?.trim() ||
        'gpt-4o-mini',
      reasoningEffort: env.AGEHA_ECLOSION_REASONING_EFFORT?.trim() || null,
      maxTokens: intEnv(env, 'AGEHA_ECLOSION_MAX_TOKENS', 16000),
      timeoutMs: intEnv(env, 'AGEHA_ECLOSION_TIMEOUT_MS', 240000),
      dailyTokenBudget: intEnv(env, 'AGEHA_ECLOSION_DAILY_TOKEN_BUDGET', 2000000),
      // 今日世界（§6.1/§9.2）：热点源与 scheduler 项，无 AGEHA_AI_* 回退（非上游配置）。
      trendingUrl:
        env.AGEHA_ECLOSION_TRENDING_URL?.trim() ||
        'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml',
      trendingTtlMs: intEnv(env, 'AGEHA_ECLOSION_TRENDING_TTL_MS', 6 * 60 * 60 * 1000),
      trendingTimeoutMs: intEnv(env, 'AGEHA_ECLOSION_TRENDING_TIMEOUT_MS', 10_000),
      worldSchedulerEnabled: boolEnv(env, 'AGEHA_ECLOSION_WORLD_SCHEDULER', true),
      worldSchedulerIntervalMs: intEnv(env, 'AGEHA_ECLOSION_WORLD_SCHEDULER_INTERVAL_MS', 10 * 60 * 1000),
    },
  }
}
