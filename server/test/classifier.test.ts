import { describe, expect, it } from 'vitest'

import { classifyContentText } from '../src/classifier'

describe('content classifier（服务端权威版，DDS §8.4）', () => {
  it('passes benign text through with trimmed content', () => {
    expect(classifyContentText('  今天适合把窗口排成两列，效率更高。  ')).toEqual({
      classification: 'ok',
      text: '今天适合把窗口排成两列，效率更高。',
    })
  })

  it('flags banned words as violation (case-insensitive)', () => {
    expect(classifyContentText('周末去赌场逛逛').classification).toBe('violation')
    expect(classifyContentText('Best CASINO bonuses').classification).toBe('violation')
  })

  it('normalizes unicode tricks before matching (全角/零宽/空格插字)', () => {
    for (const text of ['ｐｏｒｎ 推荐', 'po\u200Brn', '赌 博', 'ca\u200Bsino']) {
      expect(classifyContentText(text).classification, text).toBe('violation')
    }
    expect(classifyContentText('ＱＱ：abc12345').classification).toBe('misleading')
  })

  it('flags contact solicitation as misleading', () => {
    expect(classifyContentText('加我微信 abc123456 领取壁纸包').classification).toBe('misleading')
  })

  it('flags bare links without a source marker as misleading', () => {
    expect(classifyContentText('快看 https://example.com/post').classification).toBe('misleading')
  })

  it('accepts links that carry a source marker', () => {
    expect(classifyContentText('来源：https://example.com/post 的报道').classification).toBe('ok')
  })

  it('flags repeated-character flooding as discomfort', () => {
    expect(classifyContentText('好——————或是如此').classification).toBe('ok')
    expect(classifyContentText('哈哈哈哈哈哈哈哈哈哈哈哈').classification).toBe('discomfort')
  })

  it('flags shouting all-caps text as discomfort', () => {
    expect(classifyContentText('CLICK HERE NOW PLEASE').classification).toBe('discomfort')
  })

  it('treats whitespace-only text as misleading (route turns it into 400)', () => {
    expect(classifyContentText('   ')).toEqual({ classification: 'misleading', text: '' })
  })
})
