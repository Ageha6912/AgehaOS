/**
 * 流式 HTML 切分（设计 §4.2 第 2 条）：宿主边收 SSE 边把文本切片下发给沙箱 runner。
 *
 * 安全与渲染契约：
 * - **`<script>` 内容永不进 chunk**：整个 script 元素（开标签+内容+闭标签）在宿主侧
 *   截留，收进 `scripts()`，流结束经 `eclosion:power-on` 才注入 runner（"页面先成形、
 *   再破茧"）。这是安全关键路径——生成代码在破茧前不存在于沙箱任何位置。
 * - **仅闭合元素成片**：chunk 边界只落在顶层构造（元素/注释/结构标签）完成之后；
 *   未闭合元素与残缺标签留在内部缓冲，runner 收到的每片都能被 `<template>` 安全解析。
 * - **样式与骨架先行**：`<style>` 是普通（非截留）元素，完整闭合后立即成片。
 * - **文档结构标签剥除**：doctype/`<html>`/`<head>`/`<body>` 不下发（目标是
 *   #eclosion-root 的子树，不是独立文档）；其余标记原样透传。
 *
 * 纯 TS、与 DOM 无关；tokenizer 覆盖：引号内 `>`、CSS 子选择器 `>`、`<!-- -->` 注释、
 * void 元素、自闭合、rawtext 元素（script/style/textarea/title）、`a < b` 文本。
 */

export interface EclosionStreamChunk {
  /** 单调递增片号（0 起）；runner 用它去重/拒乱序。 */
  seq: number
  /** 可安全增量挂载的标记（只含闭合元素，绝不含 script）。 */
  html: string
}

export interface HtmlStreamSplitter {
  /** 喂入增量文本；返回本次新完成的顶层构造切片（可能为空数组）。 */
  push(text: string): EclosionStreamChunk[]
  /** 流结束：冲出缓冲内剩余内容（丢弃尾部残缺标签）；此后再 push 无效果。 */
  flush(): EclosionStreamChunk[]
  /** 截留的 script 内容，按文档出现顺序排列（破茧时按序注入）。 */
  scripts(): string[]
}

/** HTML void 元素（无闭合标签）。 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/** rawtext 内容元素：内容直到对应闭合标签，不按标记解析（与浏览器一致）。 */
const RAWTEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

/** 文档结构标签：剥除不下发（挂载目标是 #eclosion-root）。 */
const STRUCTURAL_ELEMENTS = new Set(['html', 'head', 'body'])

type ScanState = 'text' | 'markup' | 'rawtext'

interface TagEnd {
  /** 标签结束 '>' 的下一个字符位置。 */
  next: number
  /** 紧邻 '>' 前是否是 '/'（自闭合写法）。 */
  selfClosing: boolean
}

/** 在 from 起的标签内部找 '>'（跳过引号内的 '>'）。找不到返回 null（标签残缺，等待更多数据）。 */
function findTagEnd(buffer: string, from: number): TagEnd | null {
  let quote: string | null = null
  for (let i = from; i < buffer.length; i += 1) {
    const ch = buffer[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return { next: i + 1, selfClosing: buffer[i - 1] === '/' }
  }
  return null
}

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

/** 扫描标签名：返回 [名末位置, 小写名]；名后字符非字母即定界。 */
function scanTagName(buffer: string, from: number): { nameEnd: number; name: string } {
  let nameEnd = from
  while (nameEnd < buffer.length && isLetter(buffer[nameEnd])) nameEnd += 1
  return { nameEnd, name: buffer.slice(from, nameEnd).toLowerCase() }
}

/** 大小写不敏感地找 `</name` 且其后是 '>'、'/' 或空白（HTML 规范的「适当闭合标签」）。 */
function findRawtextClose(lowered: string, name: string, from: number): number {
  const needle = `</${name}`
  let search = from
  for (;;) {
    const idx = lowered.indexOf(needle, search)
    if (idx === -1) return -1
    const after = lowered[idx + needle.length]
    if (after === undefined || after === '>' || after === '/' || after === ' ' || after === '\t' || after === '\n' || after === '\r') {
      return idx
    }
    search = idx + 1
  }
}

export function createHtmlStreamSplitter(): HtmlStreamSplitter {
  let buffer = ''
  let bufferLower = '' // 与 buffer 同步增长的小写副本（rawtext 闭合扫描用，避免每次 push 全量 toLowerCase）
  let cursor = 0 // 当前扫描位置
  let state: ScanState = 'text'
  let pending = '' // 扣除 script 后待成片的输出
  const stack: string[] = [] // 开元素栈（结构标签不入栈）
  const scripts: string[] = []
  let scriptContentStart = 0
  let rawtextTag = ''
  let rawtextContentStart = 0
  let seq = 0
  let done = false

  /**
   * 成片：纯空白的 pending 不单独成片（挂载无意义且产生噪声节点），保留给下一片
   * 前缀；flush 以 force 冲出，保证重建等价（尾随空白如实保留）。
   */
  function emit(force = false): EclosionStreamChunk | null {
    if (pending === '' || (!force && pending.trim() === '')) return null
    const chunk: EclosionStreamChunk = { seq, html: pending }
    seq += 1
    pending = ''
    return chunk
  }

  function scan(): EclosionStreamChunk[] {
    const emitted: EclosionStreamChunk[] = []
    for (;;) {
      if (state === 'text') {
        const lt = buffer.indexOf('<', cursor)
        if (lt === -1) return emitted // 文本未终结：留在缓冲等待 '<'
        pending += buffer.slice(cursor, lt)
        cursor = lt
        state = 'markup'
        continue
      }

      if (state === 'markup') {
        const next = buffer[cursor + 1]
        if (next === undefined) return emitted // '<' 后无字符：等待
        if (next === '!') {
          if (buffer.startsWith('<!--', cursor)) {
            const close = buffer.indexOf('-->', cursor + 4)
            if (close === -1) return emitted
            pending += buffer.slice(cursor, close + 3) // 注释原样保留
            cursor = close + 3
          } else {
            // doctype / CDATA / 声明：剥除。
            const end = findTagEnd(buffer, cursor + 2)
            if (end === null) return emitted
            cursor = end.next
          }
        } else if (next === '?') {
          // 处理指令（bogus comment）：剥除。
          const end = findTagEnd(buffer, cursor + 1)
          if (end === null) return emitted
          cursor = end.next
        } else if (next === '/') {
          if (buffer[cursor + 2] === undefined) return emitted
          const { nameEnd, name } = scanTagName(buffer, cursor + 2)
          if (name === '') {
            // `</ foo>`：bogus comment，消费到 '>' 剥除。
            const end = findTagEnd(buffer, cursor + 2)
            if (end === null) return emitted
            cursor = end.next
          } else {
            const end = findTagEnd(buffer, nameEnd)
            if (end === null) return emitted
            if (!STRUCTURAL_ELEMENTS.has(name)) {
              const idx = stack.lastIndexOf(name)
              if (idx >= 0) stack.length = idx // 弹出到该元素；未开过的闭合标签忽略
              pending += buffer.slice(cursor, end.next)
            } // </body></html> 等结构闭合同样剥除
            cursor = end.next
          }
        } else if (isLetter(next)) {
          const { nameEnd, name } = scanTagName(buffer, cursor + 1)
          const end = findTagEnd(buffer, nameEnd)
          if (end === null) return emitted // 标签残缺：等待
          if (name === 'script') {
            scriptContentStart = end.next
          } else if (RAWTEXT_ELEMENTS.has(name)) {
            pending += buffer.slice(cursor, end.next)
            rawtextContentStart = end.next
          } else if (STRUCTURAL_ELEMENTS.has(name)) {
            // 剥除：不入栈、不进输出
          } else {
            pending += buffer.slice(cursor, end.next)
            if (!end.selfClosing && !VOID_ELEMENTS.has(name)) stack.push(name)
          }
          cursor = end.next
          if (RAWTEXT_ELEMENTS.has(name)) {
            state = 'rawtext'
            rawtextTag = name
            continue
          }
        } else {
          // '<' 后非名字字符（如 `a < b` 文本）：当作文本。
          pending += '<'
          cursor += 1
          state = 'text'
          continue
        }
        state = 'text'
        if (stack.length === 0) {
          const chunk = emit() // 顶层构造完成（元素/注释/剥除的结构标签）
          if (chunk !== null) emitted.push(chunk)
        }
        continue
      }

      // state === 'rawtext'：内容到适当闭合标签为止。
      const contentStart = rawtextTag === 'script' ? scriptContentStart : rawtextContentStart
      const close = findRawtextClose(bufferLower, rawtextTag, contentStart)
      if (close === -1) return emitted
      const tagEnd = findTagEnd(buffer, close + 2 + rawtextTag.length)
      if (tagEnd === null) return emitted
      if (rawtextTag === 'script') {
        scripts.push(buffer.slice(scriptContentStart, close)) // 截留：内容绝不进输出
      } else {
        pending += buffer.slice(rawtextContentStart, close)
        pending += buffer.slice(close, tagEnd.next) // 闭合标签
        const idx = stack.lastIndexOf(rawtextTag)
        if (idx >= 0) stack.length = idx
      }
      cursor = tagEnd.next
      state = 'text'
      if (stack.length === 0) {
        const chunk = emit()
        if (chunk !== null) emitted.push(chunk)
      }
    }
  }

  return {
    push(text: string): EclosionStreamChunk[] {
      if (done || text === '') return []
      buffer += text
      bufferLower += text.toLowerCase()
      return scan()
    },
    flush(): EclosionStreamChunk[] {
      if (done) return []
      done = true
      if (state === 'rawtext') {
        if (rawtextTag === 'script') {
          // 截断流：如实交出截留内容（破茧注入时自然报错，走回落链）。
          scripts.push(buffer.slice(scriptContentStart))
        } else {
          pending += buffer.slice(rawtextContentStart)
        }
      } else if (state === 'text') {
        pending += buffer.slice(cursor) // 尾部文本与未闭合元素（浏览器自动补齐）
      }
      // markup 态的尾部残缺标签直接丢弃。
      const final = emit(true)
      return final === null ? [] : [final]
    },
    scripts(): string[] {
      return [...scripts]
    },
  }
}
