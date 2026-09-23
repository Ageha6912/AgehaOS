import { TIP_IDS } from '../content/engine'

/**
 * LLM 增强客户端（设计文档 DDS §5.3/§8.4，Phase B 切片）。
 *
 * 走同源 `/api/ai/proxy`（CSP connect-src 'self' 禁止直连第三方；API Key 不下发）。
 * 请求体只含聚合特征 + 一次性匿名 ID（crypto.randomUUID，userId 永不出本地）。
 *
 * Phase B 阶段门控（§5.3）：LLM 输出仅接受结构化编排字段——本切片的槽位取值
 * 必须落在 PHASE_B_VOCABULARY 白名单内（提示卡变体号），自由文本一律丢弃；
 * Phase C 起面板文案可生成，届时扩展为 §8.4 过滤管线（违规/误导/不适）。
 *
 * 降级链（§5.3）：LLM 失败/超时（2s）→ 上次缓存内容（getCachedAiSlots）→
 * 本地模板（调用方自带）。会话级最多尝试 2 次（首试 + 重试 ≤1）。
 */

export const AI_PROXY_TIMEOUT_MS = 2000
export const MAX_AI_ATTEMPTS_PER_SESSION = 2

export interface AiSlot {
  slotId: string
  text: string
}

export interface AiEnhanceInput {
  locale: 'zh-CN' | 'en'
  context: Record<string, string | number | boolean>
  prefs: string[]
  slots: readonly string[]
}

/**
 * Phase B 词表门控：slotId → 允许的取值集合。LLM 返回的 text 不在词表内
 * 即丢弃（等价于被过滤管线拦下），绝不渲染自由文本。
 */
export const PHASE_B_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  tip: TIP_IDS,
}

let aiAttemptsThisSession = 0
let cachedSlots: AiSlot[] = []

export function getCachedAiSlots(): AiSlot[] {
  return cachedSlots
}

/** 测试间隔离 + 新会话重置。 */
export function resetAiSessionState(): void {
  aiAttemptsThisSession = 0
  cachedSlots = []
}

export interface AiClientOptions {
  fetchFn?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

/**
 * 请求 LLM 槽位建议。任何失败（网络/超时/HTTP 错误/过滤后为空）都抛错，
 * 由调用方走降级链；成功结果写入会话缓存。
 */
export async function requestAiSlots(
  input: AiEnhanceInput,
  options: AiClientOptions = {},
): Promise<AiSlot[]> {
  if (aiAttemptsThisSession >= MAX_AI_ATTEMPTS_PER_SESSION) {
    throw new Error('ai-session-exhausted')
  }
  aiAttemptsThisSession += 1

  const fetchFn = options.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? AI_PROXY_TIMEOUT_MS)
  try {
    const response = await fetchFn('/api/ai/proxy', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        anonymId: randomAnonymId(options.now),
        locale: input.locale,
        context: input.context,
        prefs: input.prefs,
        slots: [...input.slots],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`ai-http-${response.status}`)
    const payload = (await response.json().catch(() => null)) as unknown
    const items = filterAccepted(payload, input.slots)
    if (items.length === 0) throw new Error('ai-empty-after-filter')
    cachedSlots = items
    return items
  } finally {
    clearTimeout(timer)
  }
}

/**
 * §8.4 渲染前过滤的客户端半场：schema 白名单（未知字段/未知槽位丢弃）+
 * Phase B 词表门控 + 同槽位去重（先到先得）+ 数量上限。
 */
export function filterAccepted(payload: unknown, slots: readonly string[]): AiSlot[] {
  if (typeof payload !== 'object' || payload === null) return []
  const raw = (payload as { items?: unknown }).items
  if (!Array.isArray(raw)) return []
  const requested = new Set(slots)
  const seen = new Set<string>()
  const items: AiSlot[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const slotId = (candidate as { slotId?: unknown }).slotId
    const text = (candidate as { text?: unknown }).text
    if (typeof slotId !== 'string' || !requested.has(slotId) || seen.has(slotId)) continue
    const vocabulary = PHASE_B_VOCABULARY[slotId]
    if (typeof text !== 'string' || !vocabulary || !vocabulary.includes(text)) continue
    seen.add(slotId)
    items.push({ slotId, text })
    if (items.length >= 8) break
  }
  return items
}

function randomAnonymId(now?: () => number): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  // 一次性匿名 ID：随机部分 + 会话时钟片，不含任何用户标识。
  return `anon-${random}${now ? `-${now()}` : ''}`
}
