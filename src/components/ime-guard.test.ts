import { describe, expect, it } from 'vitest'

import { isImeComposing } from './ime-guard'

describe('isImeComposing（CJK 输入法双重互锁守卫）', () => {
  it('组合期 isComposing=true 命中', () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true)
  })

  it('keyCode 229 兜底命中（isComposing 时序不稳的引擎）', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
  })

  it('普通按键不命中', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false)
    expect(isImeComposing({ isComposing: false, keyCode: 27 })).toBe(false)
  })

  it('两路信号都缺省（如指针合成的键盘事件）不命中', () => {
    expect(isImeComposing({})).toBe(false)
  })
})
