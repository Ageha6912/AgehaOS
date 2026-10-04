import { beforeEach, describe, expect, it } from 'vitest'

import {
  consumeLauncherCategory,
  requestLauncherCategory,
  resetLauncherIntent,
} from './launcher-intent'

/**
 * 启动器「打开即定位」意图（Desktop Shell 3.0 STEP 3 今日世界入口）：
 * app-deep-link.ts 同款一次性范式——请求幂等覆盖、取走即清、无请求为 null。
 */
describe('launcher-intent', () => {
  beforeEach(() => {
    resetLauncherIntent()
  })

  it('starts empty: consume returns null', () => {
    expect(consumeLauncherCategory()).toBeNull()
  })

  it('request then consume delivers the category exactly once', () => {
    requestLauncherCategory('today')
    expect(consumeLauncherCategory()).toBe('today')
    // 取走即清：第二次消费为 null（不污染下一次普通打开）。
    expect(consumeLauncherCategory()).toBeNull()
  })

  it('a later request overwrites an unconsumed one', () => {
    requestLauncherCategory('today')
    requestLauncherCategory('today')
    expect(consumeLauncherCategory()).toBe('today')
    expect(consumeLauncherCategory()).toBeNull()
  })

  it('reset clears an unconsumed request', () => {
    requestLauncherCategory('today')
    resetLauncherIntent()
    expect(consumeLauncherCategory()).toBeNull()
  })
})
