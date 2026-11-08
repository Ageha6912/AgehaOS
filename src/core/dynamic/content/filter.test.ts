import { describe, expect, it } from 'vitest'

import { filterContentText } from './filter'

describe('filterContentText (DDS §8.4 本地半场)', () => {
  it('passes clean everyday text', () => {
    expect(filterContentText('今天适合整理文档，顺便休息一下。')).toMatchObject({
      ok: true,
      text: '今天适合整理文档，顺便休息一下。',
    })
    expect(filterContentText('Try the new wallpaper engine!').ok).toBe(true)
  })

  it('rejects banned vocabulary as violation', () => {
    expect(filterContentText('最佳在线赌场推荐')).toMatchObject({ ok: false, reason: 'violation' })
    expect(filterContentText('Check out this CASINO deal')).toMatchObject({
      ok: false,
      reason: 'violation',
    })
  })

  it('normalizes unicode tricks before matching (全角/零宽/空格插字)', () => {
    for (const text of ['ｐｏｒｎ 推荐', 'po\u200Brn', '赌 博', 'ca\u200Bsino']) {
      expect(filterContentText(text), text).toMatchObject({ ok: false, reason: 'violation' })
    }
    // 全角联系方式同样命中误导规则。
    expect(filterContentText('ＱＱ：abc12345')).toMatchObject({ ok: false, reason: 'misleading' })
  })

  it('rejects contact-info solicitation as misleading', () => {
    expect(filterContentText('加微信 abc12345 领福利')).toMatchObject({ ok: false, reason: 'misleading' })
    expect(filterContentText('TG: @somechannel')).toMatchObject({ ok: false, reason: 'misleading' })
  })

  it('rejects bare links without a source marker', () => {
    expect(filterContentText('快看 https://example.com/a')).toMatchObject({
      ok: false,
      reason: 'misleading',
    })
    // 带来源标注的链接放行。
    expect(filterContentText('来源：https://example.com 的一篇报道').ok).toBe(true)
  })

  it('rejects shouty and spammy text as discomfort', () => {
    expect(filterContentText('CONGRATULATIONS CLICK NOW')).toMatchObject({
      ok: false,
      reason: 'discomfort',
    })
    expect(filterContentText('哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈')).toMatchObject({
      ok: false,
      reason: 'discomfort',
    })
    expect(filterContentText('----------')).toMatchObject({ ok: false, reason: 'discomfort' })
  })

  it('rejects empty text', () => {
    expect(filterContentText('   ').ok).toBe(false)
  })
})
