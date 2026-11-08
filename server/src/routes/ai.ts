import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { AiProxyConfig } from '../config'

export interface AiRoutesOptions {
  ai: AiProxyConfig
  rateLimitWindowMs: number
  /** Injectable upstream transport for tests; defaults to global fetch. */
  fetcher?: typeof fetch
}

interface AiRequestBody {
  anonymId: string
  locale: 'zh-CN' | 'en'
  context: Record<string, string | number | boolean>
  prefs: string[]
  slots: string[]
}

interface AiSlotItem {
  slotId: string
  text: string
}

/** DDS §5.3 request contract: aggregated features + one-time anonymous id only. */
const aiRequestSchema = {
  type: 'object',
  required: ['anonymId', 'locale', 'context', 'prefs', 'slots'],
  additionalProperties: false,
  properties: {
    anonymId: { type: 'string', minLength: 8, maxLength: 64 },
    locale: { type: 'string', enum: ['zh-CN', 'en'] },
    context: { type: 'object', maxProperties: 16 },
    prefs: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 20 },
    slots: { type: 'array', items: { type: 'string', maxLength: 32 }, minItems: 1, maxItems: 8 },
  },
}

const CONTEXT_BUDGET_BYTES = 2048
const MAX_TEXT_LENGTH = 200
const MAX_ITEMS = 8

const SYSTEM_PROMPT =
  'You are the content orchestrator of AgehaOS, a web desktop. ' +
  'You receive locale, aggregated context features, preference tags and a list of slot ids. ' +
  'Answer with STRICT JSON only: {"items":[{"slotId":"<one of the given slot ids>","text":"<value>"}]}. ' +
  'No markdown, no commentary. The meaning of each value is defined by the slot id; use at most 200 characters per value.'

/**
 * Same-origin LLM proxy (DDS §5.3): the API key never leaves the server, the
 * anonymous id is consumed for server-side keying only and is NOT forwarded
 * upstream, and the upstream answer is schema-filtered — unknown fields and
 * out-of-vocabulary slots are dropped before the response leaves the server.
 */
export async function aiRoutes(app: FastifyInstance, options: AiRoutesOptions): Promise<void> {
  const fetcher = options.fetcher ?? fetch

  app.post(
    '/ai/proxy',
    {
      schema: { body: aiRequestSchema },
      config: { rateLimit: { max: 20, timeWindow: options.rateLimitWindowMs } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!options.ai.apiKey) {
        return reply.code(503).send({ error: 'ai-not-configured' })
      }
      const body = request.body as AiRequestBody
      if (JSON.stringify(body.context).length > CONTEXT_BUDGET_BYTES) {
        return reply.code(400).send({ error: 'invalid-body' })
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.ai.timeoutMs)
      try {
        // anonymId stays server-side: the upstream sees aggregated features only.
        const upstream = await fetcher(`${options.ai.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.ai.apiKey}`,
          },
          body: JSON.stringify({
            model: options.ai.model,
            temperature: 0.7,
            max_tokens: 500,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: JSON.stringify({
                  locale: body.locale,
                  context: body.context,
                  prefs: body.prefs,
                  slots: body.slots,
                }),
              },
            ],
          }),
          signal: controller.signal,
        })
        if (!upstream.ok) {
          app.log.warn({ audit: 'ai.upstream_error', status: upstream.status }, 'ai upstream failed')
          // 消费失败分支的响应体，否则 keepAlive 连接因 body 未读尽被挂到 GC。
          await upstream.body?.cancel().catch(() => undefined)
          return reply.code(502).send({ error: 'ai-upstream' })
        }
        const payload = (await upstream.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>
        }
        const content = payload.choices?.[0]?.message?.content
        const items = typeof content === 'string' ? parseItems(content, body.slots) : null
        if (items === null) {
          app.log.warn({ audit: 'ai.invalid_response' }, 'ai upstream returned unparseable content')
          return reply.code(502).send({ error: 'ai-invalid-response' })
        }
        app.log.info({ audit: 'ai.proxy', count: items.length }, 'ai proxy served')
        return reply.code(200).send({ items })
      } catch (cause) {
        if (isAbortError(cause)) {
          app.log.warn({ audit: 'ai.timeout' }, 'ai upstream timed out')
          return reply.code(504).send({ error: 'ai-timeout' })
        }
        app.log.warn({ audit: 'ai.upstream_error' }, 'ai upstream unreachable')
        return reply.code(502).send({ error: 'ai-upstream' })
      } finally {
        clearTimeout(timer)
      }
    },
  )
}

/**
 * Parses the model's answer into schema-clean slot items. Returns null when
 * the content is not JSON at all; items failing validation are dropped
 * silently (the client treats an empty list as a fallback trigger).
 */
export function parseItems(content: string, slots: readonly string[]): AiSlotItem[] | null {
  const json = content.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const raw = (parsed as { items?: unknown }).items
  if (!Array.isArray(raw)) return null
  const allowed = new Set(slots)
  const seen = new Set<string>()
  const items: AiSlotItem[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const slotId = (candidate as { slotId?: unknown }).slotId
    const text = (candidate as { text?: unknown }).text
    if (typeof slotId !== 'string' || !allowed.has(slotId) || seen.has(slotId)) continue
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) continue
    seen.add(slotId)
    items.push({ slotId, text })
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

function isAbortError(cause: unknown): cause is Error {
  return cause instanceof Error && cause.name === 'AbortError'
}
