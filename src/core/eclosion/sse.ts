/**
 * SSE 帧解析（设计 §5.3：/api/eclosion/generate 以 SSE 下发 meta/think/delta/done/error）。
 *
 * 与传输无关的纯解析器：消费任意切块的文本（fetch + ReadableStream 逐 chunk 喂入），
 * 按 WHATWG HTML §9.2.6「Interpreting an event stream」的语义吐出完整帧：
 * - 行分隔符 CRLF / LF / CR 三种都接受；CR 落在缓冲末尾时等待下一个 chunk 再判定。
 * - `event:` / `data:` 字段；`data` 多行以 `\n` 连接；`:comment`、`id`、`retry`、未知字段忽略。
 * - 冒号后至多剥一个前导空格；无事件名时默认 `message`。
 * - 只有含 data 字段的帧才会派发（data 为空字符串也算）；跨 chunk 的半帧留在内部缓冲。
 * - 流首 BOM 按规范剥除。
 */

export interface SseFrame {
  /** 事件名；未声明 event: 字段时为 'message'。 */
  event: string
  /** data 字段值（多行已用 \n 连接，末尾换行已移除）。 */
  data: string
}

export interface SseParser {
  /** 喂入一段增量文本，返回其中完整落地的帧（可能为零个、一个或多个）。 */
  push(chunk: string): SseFrame[]
  /**
   * 流结束：把缓冲末尾悬挂的 CR 视为行终止（CRLF 无法再补齐），冲出半行与未终结帧。
   * 不 close 的流若恰好停在 `\r` 上，最后一帧会留在缓冲里。
   */
  close(): SseFrame[]
}

/** 找到 buffer 中 from 起下一条完整行的结尾：返回 { line, next（下一行起点）}；行不完整（CR 后待定）返回 null。 */
function nextLine(buffer: string, from: number): { line: string; next: number } | null {
  for (let i = from; i < buffer.length; i += 1) {
    const ch = buffer[i]
    if (ch === '\n') return { line: buffer.slice(from, i), next: i + 1 }
    if (ch === '\r') {
      // CR 是行尾；若后面还有字符则可能是 CRLF，若 CR 恰在缓冲末尾则等下个 chunk。
      if (i + 1 === buffer.length) return null
      if (buffer[i + 1] === '\n') return { line: buffer.slice(from, i), next: i + 2 }
      return { line: buffer.slice(from, i), next: i + 1 }
    }
  }
  return null
}

export function createSseParser(): SseParser {
  let buffer = ''
  let started = false // 是否已剥过流首 BOM
  let eventName = ''
  let dataBuffer = ''

  function dispatch(): SseFrame | null {
    // 规范：data 缓冲为空（没有任何 data 字段）时不派发，仅重置事件名。
    if (dataBuffer === '') {
      eventName = ''
      return null
    }
    const frame: SseFrame = { event: eventName === '' ? 'message' : eventName, data: dataBuffer.slice(0, -1) }
    eventName = ''
    dataBuffer = ''
    return frame
  }

  function processLine(line: string): SseFrame | null {
    if (line === '') return dispatch()
    if (line[0] === ':') return null // 注释
    let field: string
    let value: string
    const colon = line.indexOf(':')
    if (colon === -1) {
      field = line
      value = ''
    } else {
      field = line.slice(0, colon)
      value = line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1) // 至多剥一个前导空格
    }
    if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataBuffer += `${value}\n`
    }
    // id / retry / 未知字段：忽略
    return null
  }

  function processRemaining(): SseFrame[] {
    const frames: SseFrame[] = []
    if (buffer !== '') {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      buffer = ''
      const frame = processLine(line)
      if (frame !== null) frames.push(frame)
      const final = dispatch() // 流结束即帧终结（无结尾空行也派发）
      if (final !== null) frames.push(final)
    }
    return frames
  }

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk
      if (!started) {
        started = true
        if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1)
      }
      const frames: SseFrame[] = []
      for (;;) {
        const found = nextLine(buffer, 0)
        if (found === null) break
        buffer = buffer.slice(found.next)
        const frame = processLine(found.line)
        if (frame !== null) frames.push(frame)
      }
      return frames
    },
    close(): SseFrame[] {
      return processRemaining()
    },
  }
}
