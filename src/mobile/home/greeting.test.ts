import { describe, expect, it } from 'vitest'

import { greetingJoinKey, greetingPhaseKey, mobileGreetingPhase } from './greeting'

/**
 * M1-1 移动 Home 时段问候分档：纯函数边界钉扎。三档边界（左闭右开）
 * 与桌面时段引擎同源（5/11/17，core/dynamic/generative/seed timePhaseOf），
 * 夜相（22–次日 5 点）并入 evening 档——移动问候只有早/午/晚三档文案。
 */
describe('mobileGreetingPhase', () => {
  it('morning = [5, 11)：5 点入档、10 点仍在档', () => {
    expect(mobileGreetingPhase(5)).toBe('morning')
    expect(mobileGreetingPhase(7)).toBe('morning')
    expect(mobileGreetingPhase(10)).toBe('morning')
  })

  it('afternoon = [11, 17)：11 点换档、16 点收尾', () => {
    expect(mobileGreetingPhase(11)).toBe('afternoon')
    expect(mobileGreetingPhase(14)).toBe('afternoon')
    expect(mobileGreetingPhase(16)).toBe('afternoon')
  })

  it('evening = [17, 24) ∪ [0, 5)：傍晚入档、深夜与凌晨同档', () => {
    expect(mobileGreetingPhase(17)).toBe('evening')
    expect(mobileGreetingPhase(20)).toBe('evening')
    expect(mobileGreetingPhase(23)).toBe('evening')
    expect(mobileGreetingPhase(0)).toBe('evening')
    expect(mobileGreetingPhase(4)).toBe('evening')
  })

  it('边界互斥且全覆盖 24 小时（相邻边界不重不漏）', () => {
    const buckets = Array.from({ length: 24 }, (_, hour) => mobileGreetingPhase(hour))
    expect(buckets.filter((phase) => phase === 'morning')).toHaveLength(6)
    expect(buckets.filter((phase) => phase === 'afternoon')).toHaveLength(6)
    expect(buckets.filter((phase) => phase === 'evening')).toHaveLength(12)
  })
})

describe('问候词典键', () => {
  it('三档各映射到 mobile.home.greeting.* 键，连接符固定键位', () => {
    expect(greetingPhaseKey('morning')).toBe('mobile.home.greeting.morning')
    expect(greetingPhaseKey('afternoon')).toBe('mobile.home.greeting.afternoon')
    expect(greetingPhaseKey('evening')).toBe('mobile.home.greeting.evening')
    expect(greetingJoinKey()).toBe('mobile.home.greeting.join')
  })
})
