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

export interface ServerConfig {
  host: string
  port: number
  store: StoreKind
  /** File-store data directory (file store only). */
  dataDir: string
  /** Postgres connection string (postgres store only). */
  databaseUrl: string | null
  sessionTtlMs: number
  cookieSecure: boolean
  logLevel: string
  rateLimit: {
    loginMax: number
    registerMax: number
    windowMs: number
  }
  /** Extra allowed CSRF origins beyond the request's own host. */
  allowedOrigins: string[]
  ai: AiProxyConfig
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
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
  const storeEnv = env.AGEHA_STORE?.trim()
  const store: StoreKind =
    storeEnv === 'memory' || storeEnv === 'file' || storeEnv === 'postgres'
      ? storeEnv
      : databaseUrl
        ? 'postgres'
        : 'file'

  return {
    host: env.AGEHA_HOST ?? '127.0.0.1',
    port: intEnv('AGEHA_PORT', 8787),
    store,
    dataDir: env.AGEHA_DATA_DIR
      ? path.resolve(env.AGEHA_DATA_DIR)
      : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'),
    databaseUrl,
    sessionTtlMs: intEnv('AGEHA_SESSION_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    cookieSecure: nodeEnv === 'production',
    logLevel: env.AGEHA_LOG_LEVEL ?? 'info',
    rateLimit: {
      loginMax: intEnv('AGEHA_RATE_LIMIT_LOGIN_MAX', 10),
      registerMax: intEnv('AGEHA_RATE_LIMIT_REGISTER_MAX', 20),
      windowMs: intEnv('AGEHA_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    },
    allowedOrigins: listEnv('AGEHA_ALLOWED_ORIGINS'),
    ai: {
      apiKey: env.AGEHA_AI_API_KEY?.trim() || null,
      baseUrl: env.AGEHA_AI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      model: env.AGEHA_AI_MODEL?.trim() || 'gpt-4o-mini',
      timeoutMs: intEnv('AGEHA_AI_TIMEOUT_MS', 2000),
    },
  }
}
