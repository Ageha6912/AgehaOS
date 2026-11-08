import { Buffer } from 'node:buffer'

/**
 * 羽化输出结构闸（AI-GENERATED-APPS-DESIGN §5.1）——流式形态。
 *
 * 上游 token 边流边出，闸必须在不攒全量的前提下清洗：
 * - **头部**：丢弃 `<!doctype`/`<html` 之前的一切前缀（模型寒暄、Markdown
 *   围栏 ```html 等自然随之剥落）；8KB 仍未出现文档起点 → invalid。
 * - **尾部**：常备 24 字符 holdback，流末的收尾围栏 ``` 落在 holdback 内，
 *   finalize 时剥除，永不下发客户端。
 * - **外链降噪**（CSP 才是真闸）：静态扫描 `src`/`href`/`srcset`/`xlink:href`/
 *   `poster`、CSS `url(`、`@import`；绝对（`http(s)://`）与协议相对（`//host`）
 *   URL 均算外链，命中即整段移除（到引号/右括号/分号为止，跨度可跨 chunk
 *   续等），样本留给审计日志。匹配起点落在 holdback 之外才可能漏扫，24 字符
 *   覆盖全部模式的最长半截形态。
 * - **script 区间不剥离**（A3 审查）：`<script>` 正文是 JS rawtext，剥离
 *   `s.src='https://…'` 会制造 `el.;` 之类残句；语法检查跑在未剥离的原文上，
 *   残句不会触发 invalid-output，坏应用会直接黑屏。外链契约在 script 正文由
 *   CSP 兜底；开标签内的 `src=` 仍剥离。
 * - **60KB 上限**：按原始文档字节数计，超限即截断（停止转发余量）并标记
 *   invalid-output，不进缓存。
 */

export const MAX_HTML_BYTES = 60 * 1024

type RemovalKind = 'attribute' | 'url' | 'import'

interface ExternalHit {
  index: number
  length: number
  kind: RemovalKind
  /** 匹配中出现的字面开引号（src=" / url(" 形态），移除跨度闭合同一引号。
   *  实体引号（`&quot;` 等）在浏览器里只是无引号属性值中的普通字符，按无引号
   *  形态处理（扫描时仍须认出来，否则整段漏删）。 */
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

/** 引号（含 HTML 实体形态；匹配组只用于取字面引号作闭合符）。 */
const QUOTE_PATTERN = String.raw`(?:"|'|&quot;|&#0*34;|&#[xX]0*22;|&apos;|&#0*39;|&#[xX]0*27;)`
/** 外链前缀：绝对 URL 与协议相对 URL（`//host` 在浏览器里同样是跨主机）。 */
const EXTERNAL_URL = String.raw`(?:https?:)?\/\/`

const EXTERNAL_PATTERNS: ReadonlyArray<{ kind: RemovalKind; re: RegExp }> = [
  {
    kind: 'attribute',
    re: new RegExp(
      String.raw`\b(?:xlink:href|href|srcset|src|poster)\s*=\s*(${QUOTE_PATTERN})?\s*${EXTERNAL_URL}`,
      'i',
    ),
  },
  { kind: 'url', re: new RegExp(String.raw`url\(\s*(${QUOTE_PATTERN})?\s*${EXTERNAL_URL}`, 'i') },
  { kind: 'import', re: /@import\b/i },
]

/** `<script` 开标签（rawtext 起点）：正文里的外部赋值不得剥离。 */
const SCRIPT_OPEN = /<script\b/i
const SCRIPT_CLOSE = /<\/script\s*>/i
/** 跨 chunk 侦测 `</script >` 的尾巴长度（含空白变体）。 */
const SCRIPT_CLOSE_HOLD_CHARS = 12

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
  /**
   * 已被流式下发但 finalize 剥除（尾部围栏/</html> 后垃圾）的字符数
   * （A3 审查轻微项）：>0 时纯增量 delta 无法撤回已发内容，流式路由必须
   * 发「整文替换」帧，否则客户端拼流 ≠ 缓存全文。
   */
  overshoot: number
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
  if (hit.kind === 'attribute') {
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
 * 「自言自语」，会以可见垃圾文本出现在页面上）。`</html>` 出现在 script
 * 正文字符串里时不算文档封口（A3 审查：rawtext 内的 `</html>` 是 JS 内容）。
 */
function truncateAfterHtmlClose(html: string): string {
  const scan = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<\/html\s*>/gi
  for (const match of html.matchAll(scan)) {
    if (/^<\/html/i.test(match[0])) {
      return html.slice(0, (match.index ?? 0) + match[0].length)
    }
  }
  return html
}

/** 开标签结束的 `>`（跳过引号内的 `>`），未闭合返回 -1。 */
function findTagEnd(text: string): number {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return i
  }
  return -1
}

/**
 * 剥离一段**完整**文本里的全部外链命中（script 开标签等有限区间用；不处理
 * 跨 chunk 续等——调用方只传已闭合片段）。返回清洗结果，样本追加到
 * `removedSamples`。
 */
function stripExternalWithin(text: string, removedSamples: string[]): string {
  let rest = text
  let out = ''
  for (;;) {
    const hit = findExternal(rest)
    if (!hit) return out + rest
    out += rest.slice(0, hit.index)
    rest = rest.slice(hit.index)
    const end = findRemovalEnd(rest, hit)
    if (end === null) {
      // 完整片段里终结符未到（如属性值一直写到标签尾）：整段丢弃。
      removedSamples.push(rest.slice(0, 96))
      return out
    }
    removedSamples.push(rest.slice(0, Math.min(end, 96)))
    rest = rest.slice(end)
  }
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
  /** 处于 `<script>` rawtext 区间：正文原样转发，不扫外链（A3 审查）。 */
  private inScript = false
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
      // 头部前缀与文档起点同处一次 push 时也要计入 8KB 限额（A3 审查：原先
      // 只在「无命中的推送间隙」评估，前导垃圾可超发到 8KB+单次 push）。
      if (this.headBytes > HEAD_LIMIT_BYTES) {
        this.dead = 'no-document'
        this.buffer = ''
        return ''
      }
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
        overshoot: 0,
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
        overshoot: 0,
      }
    }
    const html = truncateAfterHtmlClose(stripTrailingFence(this.emitted.join('')))
    return {
      html,
      invalid: false,
      reason: null,
      removedSamples: this.removedSamples,
      flush: html.slice(Math.min(forwardedBefore, html.length)),
      overshoot: Math.max(0, forwardedBefore - html.length),
    }
  }

  private prospectiveDocBytes(next: number): boolean {
    return next > MAX_HTML_BYTES
  }

  /**
   * 清洗并前移 buffer：flushHoldback 之前的已清文本发出，其余保留。
   * script 正文原样转发（不扫外链）；非脚本区循环处理多个外链命中，
   * script 开标签、`</html>` 封口与外链命中按位置先后处理。
   */
  private drain(buffer: string, flushHoldback: number): string {
    let rest = buffer
    let emit = ''
    for (;;) {
      if (this.inScript) {
        const closeTag = SCRIPT_CLOSE.exec(rest)
        if (closeTag) {
          const end = closeTag.index + closeTag[0].length
          emit += rest.slice(0, end)
          rest = rest.slice(end)
          this.inScript = false
          continue
        }
        // 未闭合：正文原样发出，只留尾巴侦测跨 chunk 的 </script。
        if (flushHoldback === 0) {
          emit += rest
          rest = ''
        } else {
          const keep = Math.max(flushHoldback, SCRIPT_CLOSE_HOLD_CHARS)
          if (rest.length > keep) {
            emit += rest.slice(0, rest.length - keep)
            rest = rest.slice(-keep)
          }
        }
        break
      }

      // 脚本起点 / 文档封口 / 外链命中，谁最靠前处理谁。
      const scriptOpen = SCRIPT_OPEN.exec(rest)
      const close = /<\/html\s*>/i.exec(rest)
      const hit = findExternal(rest)
      const scriptIndex = scriptOpen ? scriptOpen.index : Number.POSITIVE_INFINITY
      const closeIndex = close ? close.index : Number.POSITIVE_INFINITY
      const hitIndex = hit ? hit.index : Number.POSITIVE_INFINITY

      // 脚本起点最先：开标签可能跨 chunk，先发标签前的文本，等 `>` 到了再
      // 清洗标签（开标签内的 src= 属外链；正文不剥离）。
      if (scriptOpen && scriptIndex < closeIndex && scriptIndex < hitIndex) {
        const tagEnd = findTagEnd(rest.slice(scriptIndex))
        if (tagEnd === -1) {
          if (flushHoldback === 0) {
            emit += rest
            rest = ''
          } else {
            emit += rest.slice(0, scriptIndex)
            rest = rest.slice(scriptIndex)
          }
          break
        }
        const tag = rest.slice(scriptIndex, scriptIndex + tagEnd + 1)
        emit += rest.slice(0, scriptIndex) + stripExternalWithin(tag, this.removedSamples)
        rest = rest.slice(scriptIndex + tagEnd + 1)
        this.inScript = true
        continue
      }

      if (close && closeIndex < hitIndex) {
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
