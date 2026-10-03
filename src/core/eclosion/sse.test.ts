import { describe, expect, it } from 'vitest'

import { createSseParser, type SseFrame } from './sse'

/** 便捷：一次喂入全部文本并收尾。 */
function parseAll(text: string) {
  const parser = createSseParser()
  return [...parser.push(text), ...parser.close()]
}

describe('SSE 帧解析（设计 §5.3）', () => {
  it('parses a basic frame with event and data fields', () => {
    const frames = parseAll('event: delta\ndata: {"text":"<div>"}\n\n')
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"<div>"}' }])
  })

  it('defaults the event name to message', () => {
    const frames = parseAll('data: hello\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('joins multi-line data with newlines', () => {
    const frames = parseAll('event: delta\ndata: line1\ndata: line2\ndata:\n\n')
    expect(frames).toEqual([{ event: 'delta', data: 'line1\nline2\n' }])
  })

  it('dispatches a frame whose only data field is empty', () => {
    const frames = parseAll('data:\n\n')
    expect(frames).toEqual([{ event: 'message', data: '' }])
  })

  it('does not dispatch frames without data fields', () => {
    expect(parseAll('event: meta\n\n')).toEqual([])
    expect(parseAll('event: meta\nid: 7\n\n')).toEqual([])
  })

  it('accepts CRLF and lone CR line terminators', () => {
    expect(parseAll('event: think\r\ndata: 12\r\n\r\n')).toEqual([{ event: 'think', data: '12' }])
    expect(parseAll('event: done\rdata: 5\r\r')).toEqual([{ event: 'done', data: '5' }])
  })

  it('ignores comments, id/retry and unknown fields', () => {
    const frames = parseAll(': keep-alive\nid: 42\nretry: 1000\nx-custom: ignored\nevent: delta\ndata: x\n\n')
    expect(frames).toEqual([{ event: 'delta', data: 'x' }])
  })

  it('handles fields without a colon and strips at most one leading space', () => {
    // 「data」整行无冒号 → 空值字段；「data:  v」只剥一个空格。
    expect(parseAll('data\n\n')).toEqual([{ event: 'message', data: '' }])
    expect(parseAll('data:  two spaces\n\n')).toEqual([{ event: 'message', data: ' two spaces' }])
  })

  it('parses multiple frames from a single chunk', () => {
    const frames = parseAll('event: meta\ndata: {"model":"m"}\n\nevent: delta\ndata: a\n\nevent: done\ndata: ok\n\n')
    expect(frames.map((f) => f.event)).toEqual(['meta', 'delta', 'done'])
    expect(frames.map((f) => f.data)).toEqual(['{"model":"m"}', 'a', 'ok'])
  })
})

describe('SSE 跨 chunk 边界', () => {
  it('reassembles frames split at arbitrary byte boundaries', () => {
    const parser = createSseParser()
    const text = 'event: delta\ndata: {"text":"<div class=\\"a\\">"}\n\nevent: done\ndata: ok\n\n'
    // 逐字符喂入：任何边界都不应产生错帧或丢帧。
    const frames: SseFrame[] = []
    for (const ch of text) frames.push(...parser.push(ch))
    frames.push(...parser.close())
    expect(frames).toEqual([
      { event: 'delta', data: '{"text":"<div class=\\"a\\">"}' },
      { event: 'done', data: 'ok' },
    ])
  })

  it('close() flushes a frame whose terminator never arrived (truncated stream)', () => {
    const parser = createSseParser()
    expect(parser.push('event: delta\ndata: partial')).toEqual([])
    expect(parser.close()).toEqual([{ event: 'delta', data: 'partial' }])
  })

  it('waits for the LF after a trailing CR before completing the line', () => {
    const parser = createSseParser()
    expect(parser.push('data: x\r')).toEqual([]) // CRLF 的 CR 已到但 LF 未到
    expect(parser.push('\n')).toEqual([]) // 行完结，但帧未终结（无空行）
    expect(parser.push('\r\n')).toEqual([{ event: 'message', data: 'x' }])
  })

  it('keeps a partial line buffered across chunks', () => {
    const parser = createSseParser()
    expect(parser.push('event: del')).toEqual([])
    expect(parser.push('ta\nda')).toEqual([])
    expect(parser.push('ta: hi\n')).toEqual([])
    expect(parser.push('\n')).toEqual([{ event: 'delta', data: 'hi' }])
  })

  it('strips a leading BOM from the stream', () => {
    expect(parseAll('\ufeffdata: x\n\n')).toEqual([{ event: 'message', data: 'x' }])
  })
})
