import type { EclosionConfig } from '../config'

/**
 * OpenAI 兼容上游的流式客户端（羽化模式专用，AI-GENERATED-APPS-DESIGN §9.1）。
 *
 * 与 /api/ai/proxy 的非流式转发互不影响：本模块 stream:true、超时与 max_tokens
 * 走 AGEHA_ECLOSION_*（默认 240s / 16000），API Key 只在本进程使用。
 *
 * SSE 解析与前端 src/core/eclosion/sse.ts 同语义但**独立实现**（server 禁止
 * 依赖 src/，ARCHITECTURE §2）：只取 `data:` 行，`[DONE]` 结束，容忍 CRLF 与
 * 跨 chunk 半帧。思考增量取 delta.reasoning_content（DeepSeek 系）或
 * delta.reasoning（OpenAI 系）两种键名，仅接受字符串。
 */

export interface EclosionUpstreamMessage {
  role: 'system' | 'user'
  content: string
}

/** 上游失败（非 2xx / 无 body / 网络拒绝）；超时与客户端断开以 AbortError 透传由路由归类。 */
export class EclosionUpstreamError extends Error {
  constructor(
    public readonly code: 'ai-upstream',
    message: string,
  ) {
    super(message)
    this.name = 'EclosionUpstreamError'
  }
}

export interface StreamCompletionCallbacks {
  /** 推理/思考增量（原文本片段）。 */
  onReasoningDelta?: (text: string) => void
  /** 正文增量（HTML 片段）。 */
  onContentDelta?: (text: string) => void
}

export interface StreamCompletionResult {
  /** 全部正文（未清洗的原始输出）。 */
  content: string
  reasoningChars: number
  /** 上游回报的总 token 数（stream_options.include_usage）；缺省 null 由调用方估算。 */
  usageTokens: number | null
}

/** 流式累积上限（A3 审查）：异常/恶意上游在 240s 时限内可灌入数百 MB——
 *  max_tokens 只是请求参数，上游不保证遵守；超限按 ai-upstream 中止。 */
export const MAX_CONTENT_CHARS = 1_000_000
export const MAX_REASONING_CHARS = 2_000_000

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
    }
  }>
  usage?: { total_tokens?: unknown }
}

export async function streamEclosionCompletion(params: {
  fetcher: typeof fetch
  config: EclosionConfig
  messages: EclosionUpstreamMessage[]
  signal: AbortSignal
  callbacks?: StreamCompletionCallbacks
}): Promise<StreamCompletionResult> {
  const { fetcher, config, messages, signal, callbacks } = params

  const body: Record<string, unknown> = {
    model: config.model,
    stream: true,
    max_tokens: config.maxTokens,
    messages,
    stream_options: { include_usage: true },
  }
  // reasoning_effort 与 GLM 原生 thinking 开关（2026-10-04）：GLM 系模型不尊重
  // OpenAI 风格 reasoning_effort（实测思考照旧失控，坑 76 同族），只认原生
  // thinking.type；'disabled' 翻译为 thinking 关闭（实测 43s 完整生成 vs 277s 超时）。
  if (config.reasoningEffort === 'disabled') {
    body.thinking = { type: 'disabled' }
  } else if (config.reasoningEffort) {
    body.reasoning_effort = config.reasoningEffort
  }

  let response: Response
  try {
    response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    // AbortError 原样透传（路由区分超时/断开）；其余归 ai-upstream。
    if (cause instanceof Error && cause.name === 'AbortError') throw cause
    throw new EclosionUpstreamError('ai-upstream', `upstream fetch failed: ${String(cause)}`)
  }
  if (!response.ok) {
    // 非 2xx 也要释放连接（undici 连接池在 body 未消费/cancel 前会被占用）。
    try {
      await response.body?.cancel()
    } catch {
      /* 已消费/已关闭：忽略 */
    }
    throw new EclosionUpstreamError('ai-upstream', `upstream status ${response.status}`)
  }
  if (!response.body) {
    throw new EclosionUpstreamError('ai-upstream', 'upstream returned no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoningChars = 0
  let usageTokens: number | null = null

  const consumeData = (data: string): void => {
    if (data === '[DONE]') return
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(data) as ChatChunk
    } catch {
      return // 容忍上游偶发心跳/脏行
    }
    const delta = chunk.choices?.[0]?.delta
    if (delta && typeof delta === 'object') {
      const reasoning =
        typeof delta.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta.reasoning === 'string'
            ? delta.reasoning
            : ''
      if (reasoning.length > 0) {
        if (reasoningChars + reasoning.length > MAX_REASONING_CHARS) {
          throw new EclosionUpstreamError('ai-upstream', 'reasoning output exceeds size limit')
        }
        reasoningChars += reasoning.length
        callbacks?.onReasoningDelta?.(reasoning)
      }
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        if (content.length + delta.content.length > MAX_CONTENT_CHARS) {
          throw new EclosionUpstreamError('ai-upstream', 'content output exceeds size limit')
        }
        content += delta.content
        callbacks?.onContentDelta?.(delta.content)
      }
    }
    const total = chunk.usage?.total_tokens
    if (typeof total === 'number' && Number.isFinite(total)) usageTokens = total
  }

  const consumeBuffer = (flush: boolean): void => {
    // 帧分隔 = 空行（CRLF/LF 均可）；flush=false 时保留最后一个可能未完的帧。
    let separator = /\r?\n\r?\n/.exec(buffer)
    while (separator) {
      const frame = buffer.slice(0, separator.index)
      buffer = buffer.slice(separator.index + separator[0].length)
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('data:')) consumeData(line.slice(5).trimStart())
      }
      separator = /\r?\n\r?\n/.exec(buffer)
    }
    if (flush && buffer.length > 0) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('data:')) consumeData(line.slice(5).trimStart())
      }
      buffer = ''
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      consumeBuffer(false)
    }
    buffer += decoder.decode()
    consumeBuffer(true)
  } finally {
    reader.releaseLock?.()
    try {
      await response.body?.cancel()
    } catch {
      // 上游已正常收尾或已中止时 cancel 抛错可忽略。
    }
  }

  return { content, reasoningChars, usageTokens }
}

/** 上游未回报 usage 时的保守估算（≈4 字符/token，含提示词）。 */
export function estimateTokens(promptChars: number, outputChars: number): number {
  return Math.ceil((promptChars + outputChars) / 4)
}
