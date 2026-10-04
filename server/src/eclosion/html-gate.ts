import { Buffer } from 'node:buffer'

/**
 * 羽化输出结构闸（AI-GENERATED-APPS-DESIGN §5.1）——流式形态。
 *
 * 上游 token 边流边出，闸必须在不攒全量的前提下清洗：
 * - **头部**：丢弃 `<!doctype`/`<html` 之前的一切前缀（模型寒暄、Markdown
 *   围栏 ```html 等自然随之剥落）；8KB 仍未出现文档起点 → invalid。
 * - **尾部**：常备 24 字符 holdback，流末的收尾围栏 ``` 落在 holdback 内，
 *   finalize 时剥除，永不下发客户端。
 * - **外链降噪**（CSP 才是真闸）：静态扫描 `src=http`、`url(http`、`@import`，
 *   命中即整段移除（到引号/右括号/分号为止，跨度可跨 chunk 续等），样本
 *   留给审计日志。匹配起点落在 holdback 之外才可能漏扫，24 字符覆盖全部
 *   模式的最长半截形态。
 * - **60KB 上限**：按原始文档字节数计，超限即截断（停止转发余量）并标记
 *   invalid-output，不进缓存。
 */

export const MAX_HTML_BYTES = 60 * 1024

type RemovalKind = 'src' | 'url' | 'import'

interface ExternalHit {
  index: number
  length: number
  kind: RemovalKind
  /** 匹配中出现的开引号（src=" / url(" 形态），移除跨度闭合同一引号。 */
  quote: '"' | "'" | null
}

const DOC_START = /<!doctype[\s>]|<html[\s>]/i
/** "<!doctype html".length —— 头部保留尾巴，跨 chunk 拼出文档起点。 */
const HEAD_KEEP_CHARS = 15
const HEAD_LIMIT_BYTES = 8192
/** 覆盖 `src = "https://`（含空白变体）+ 尾部围栏的半截形态。 */
const TAIL_HOLD_CHARS = 24
/** 无终结符的可疑移除跨度上限（超长垃圾 URL 整段丢弃）。 */
const REMOVAL_LIMIT_CHARS = 16 * 1024

const EXTERNAL_PATTERNS: ReadonlyArray<{ kind: RemovalKind; re: RegExp }> = [
  { kind: 'src', re: /src\s*=\s*(["'])?\s*https?:\/\//i },
  { kind: 'url', re: /url\(\s*(["'])?\s*https?:\/\//i },
  { kind: 'import', re: /@import\b/i },
]

export interface GateResult {
  /** 清洗后的完整文档（invalid 时为已转发的截断前缀）。 */
  html: string
  invalid: boolean
  reason: 'no-document' | 'oversize' | 'bad-script' | null
  /** 被移除的外链样本（前 96 字符），供审计日志；不记用户内容之外的语义。 */
  removedSamples: string[]
  /**
   * finalize 时才安全可发的增量（holdback 冲净 + 尾部围栏剥除）：
   * `html` 去掉此前 push() 已返回部分的剩余尾巴，流式路由须把它作为
   * 最后一个 delta 下发，客户端拼流才能得到完整 html。
   */
  flush: string
}

function findExternal(text: string): ExternalHit | null {
  let best: ExternalHit | null = null
  for (const { kind, re } of EXTERNAL_PATTERNS) {
    const match = re.exec(text)
    if (!match) continue
    const quote = match[1] === '"' || match[1] === "'" ? match[1] : null
    const hit: ExternalHit = { index: match.index, length: match[0].length, kind, quote }
    if (!best || hit.index < best.index) best = hit
  }
  return best
}

/** 移除跨度的结束下标（不含）；null = 终结符未到，需续等更多数据。
 *  text 已切到命中起点（text[0..hit.length) 即匹配本体），从 hit.length 起找终结符。 */
function findRemovalEnd(text: string, hit: ExternalHit): number | null {
  const from = hit.length
  if (hit.kind === 'src') {
    if (hit.quote) {
      const j = text.indexOf(hit.quote, from)
      return j === -1 ? null : j + 1
    }
    const m = /[\s>"']/.exec(text.slice(from))
    return m ? from + m.index : null
  }
  if (hit.kind === 'url') {
    const j = text.indexOf(')', from)
    return j === -1 ? null : j + 1
  }
  // @import：吃到分号（含）或行尾（不含）。
  const semi = text.indexOf(';', from)
  const nl = /[\r\n]/.exec(text.slice(from))
  if (semi !== -1 && (nl === null || semi < nl.index)) return semi + 1
  return nl ? from + nl.index : null
}

/** 剥除文档末尾的收尾 Markdown 围栏（开头围栏已随头部前缀一起丢弃）。 */
function stripTrailingFence(html: string): string {
  return html.replace(/\s*```[a-zA-Z]*\s*$/, '')
}

/**
 * 截断 </html> 之后的一切内容（2026-10-03 实测：模型偶尔在文档结束后
 * 「自言自语」，会以可见垃圾文本出现在页面上）。
 */
function truncateAfterHtmlClose(html: string): string {
  const close = /<\/html\s*>\s*/i.exec(html)
  return close ? html.slice(0, close.index + close[0].length) : html
}

/**
 * 文档内 <script> 的 JS 语法检查（2026-10-03 实测：模型偶发笔误——运算符
 * 优先级少括号、CSS 值裸写进 JS——黑屏直达用户）。语法不过 = invalid-output
 * （'bad-script'），路由照既有 invalid 路径让客户端自动重试，残次品不出闸。
 * 用 Function 构造器仅做解析（不执行）；无 script 块（纯静态文档）视为通过。
 */
function scriptSyntaxOk(html: string): boolean {
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(scriptRe)) {
    const code = match[1] ?? ''
    if (code.trim() === '') continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      new Function(code)
    } catch {
      return false
    }
  }
  return true
}

export class StreamingHtmlGate {
  private started = false
  private dead: 'no-document' | 'oversize' | 'bad-script' | null = null
  /** 已见到 </html>：文档完整，此后一切输入丢弃（模型尾部自言自语不入流）。 */
  private finished = false
  private headBytes = 0
  private docBytes = 0
  private buffer = ''
  /** 未剥离外链的原始文档累积（finalize 的语法检查用——剥离可能制造合法→非法的残句）。 */
  private raw = ''
  private readonly emitted: string[] = []
  /** push() 已返回给调用方的总字符数（final html 的已发送前缀长度）。 */
  private forwardedChars = 0
  private readonly removedSamples: string[] = []

  /** 喂入一段正文增量，返回此刻可以安全下发的清洗文本（可能为空串）。 */
  push(text: string): string {
    if (this.dead || this.finished || text.length === 0) return ''

    if (!this.started) {
      this.buffer += text
      const match = DOC_START.exec(this.buffer)
      if (!match) {
        if (this.buffer.length > HEAD_KEEP_CHARS) {
          const keep = this.buffer.slice(-HEAD_KEEP_CHARS)
          this.headBytes += Buffer.byteLength(this.buffer.slice(0, this.buffer.length - HEAD_KEEP_CHARS))
          this.buffer = keep
          if (this.headBytes > HEAD_LIMIT_BYTES) {
            this.dead = 'no-document'
            this.buffer = ''
          }
        }
        return ''
      }
      this.headBytes += Buffer.byteLength(this.buffer.slice(0, match.index))
      this.buffer = this.buffer.slice(match.index)
      this.started = true
      this.raw += this.buffer
      if (this.prospectiveDocBytes(Buffer.byteLength(this.buffer))) {
        this.docBytes += Buffer.byteLength(this.buffer)
        this.dead = 'oversize'
        this.buffer = ''
        return ''
      }
      this.docBytes += Buffer.byteLength(this.buffer)
      return this.drain(this.buffer, TAIL_HOLD_CHARS)
    }

    if (this.prospectiveDocBytes(this.docBytes + Buffer.byteLength(text))) {
      this.docBytes += Buffer.byteLength(text)
      this.dead = 'oversize'
      this.buffer = ''
      return ''
    }
    this.docBytes += Buffer.byteLength(text)
    this.raw += text
    this.buffer += text
    return this.drain(this.buffer, TAIL_HOLD_CHARS)
  }

  /** 流结束：冲净缓冲（无 holdback）、剥尾部围栏、给出终审结果。 */
  finalize(): GateResult {
    if (this.dead || !this.started) {
      const reason = this.dead ?? 'no-document'
      if (!this.dead && !this.started) this.dead = reason
      return {
        html: this.emitted.join(''),
        invalid: true,
        reason,
        removedSamples: this.removedSamples,
        flush: '',
      }
    }
    // drain 会把冲净文本并入 emitted（终结符未到的悬挂跨度留在 buffer 丢弃）；
    // flush 基线取 drain 之前的已发送长度——finalize 内部冲净不再计入。
    const forwardedBefore = this.forwardedChars
    if (!this.finished) {
      this.drain(this.buffer, 0)
    }
    this.buffer = ''
    // 语法检查跑在**未剥离外链的原始文档**上（剥离 external src 可能制造
    // 合法→非法的残句；原始代码合法就该放行——CSP 才是真闸）。
    const rawDoc = truncateAfterHtmlClose(stripTrailingFence(this.raw))
    if (!scriptSyntaxOk(rawDoc)) {
      this.dead = 'bad-script'
      return {
        html: this.emitted.join(''),
        invalid: true,
        reason: 'bad-script',
        removedSamples: this.removedSamples,
        flush: '',
      }
    }
    const html = truncateAfterHtmlClose(stripTrailingFence(this.emitted.join('')))
    return {
      html,
      invalid: false,
      reason: null,
      removedSamples: this.removedSamples,
      flush: html.slice(Math.min(forwardedBefore, html.length)),
    }
  }

  private prospectiveDocBytes(next: number): boolean {
    return next > MAX_HTML_BYTES
  }

  /**
   * 清洗并前移 buffer：flushHoldback 之前的已清文本发出，其余保留。
   * 循环处理同一 buffer 内的多个外链命中。
   */
  private drain(buffer: string, flushHoldback: number): string {
    let rest = buffer
    let emit = ''
    for (;;) {
      // 外链命中与 </html> 封口谁在前处理谁：封口只在「close 早于外链命中」
      // 时生效——否则先清洗外链跨度，封口留给下一轮（文档尾部自言自语在其
      // 后的一切内容，均不入发射流）。
      const close = /<\/html\s*>/i.exec(rest)
      const hit = findExternal(rest)
      if (close && (!hit || close.index < hit.index)) {
        emit += rest.slice(0, close.index + close[0].length)
        this.finished = true
        rest = ''
        break
      }
      if (!hit) {
        if (flushHoldback > 0 && rest.length > flushHoldback) {
          emit += rest.slice(0, rest.length - flushHoldback)
          rest = rest.slice(-flushHoldback)
        } else if (flushHoldback === 0) {
          emit += rest
          rest = ''
        }
        break
      }
      emit += rest.slice(0, hit.index)
      rest = rest.slice(hit.index)
      const end = findRemovalEnd(rest, hit)
      if (end === null) {
        if (rest.length > REMOVAL_LIMIT_CHARS) {
          // 超长无终结：按垃圾整段丢弃，避免无限占用缓冲。
          this.removedSamples.push(rest.slice(0, 96))
          rest = ''
        }
        break // 等待更多数据补齐终结符（或流末再判）
      }
      this.removedSamples.push(rest.slice(0, Math.min(end, 96)))
      rest = rest.slice(end)
    }
    this.buffer = rest
    if (emit.length > 0) {
      this.emitted.push(emit)
      this.forwardedChars += emit.length
    }
    return emit
  }
}

/** 一次性闸（单测与非流式路径共用）：整段文本直接出结果。 */
export function applyHtmlGate(text: string): GateResult {
  const gate = new StreamingHtmlGate()
  gate.push(text)
  return gate.finalize()
}
