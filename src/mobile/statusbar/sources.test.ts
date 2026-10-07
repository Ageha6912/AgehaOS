import { afterEach, describe, expect, it, vi } from 'vitest'

import { batterySourceOf, networkSourceOf } from './sources'

/**
 * M1-1 状态栏数据源纯探测：能力不可用 → null（组件 null 即整体隐藏），
 * 能力可用 → 真实读数。DESIGN.md §0.5 真实性铁律的入口守卫——jsdom 里
 * 直接喂伪造 navigator 验证，不碰真实浏览器 API。
 */

/** 在 jsdom navigator 上临时定义一项能力（getter-only 原型属性之上加实例own属性）。 */
function grantCapability(prop: 'getBattery' | 'connection', value: unknown): void {
  Object.defineProperty(window.navigator, prop, { configurable: true, value })
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'getBattery')
  Reflect.deleteProperty(window.navigator, 'connection')
})

describe('batterySourceOf', () => {
  it('getBattery 缺席 → null（整体隐藏依据）', () => {
    expect(batterySourceOf(window.navigator)).toBeNull()
  })

  it('getBattery 存在 → 返回取电入口，读数可拿到 level', async () => {
    const removeEventListener = vi.fn()
    grantCapability('getBattery', () =>
      Promise.resolve({
        level: 0.87,
        addEventListener: vi.fn(),
        removeEventListener,
      }),
    )
    const getBattery = batterySourceOf(window.navigator)
    expect(getBattery).not.toBeNull()
    const battery = await getBattery!()
    expect(battery.level).toBe(0.87)
  })

  it('getBattery 非函数（伪造脏值）→ null，不抛错', () => {
    grantCapability('getBattery', 'not-a-function')
    expect(batterySourceOf(window.navigator)).toBeNull()
  })
})

describe('networkSourceOf', () => {
  it('connection 缺席 → null（整体隐藏依据）', () => {
    expect(networkSourceOf(window.navigator)).toBeNull()
  })

  it('connection.effectiveType 可读 → onLine + effectiveType 读数', () => {
    grantCapability('connection', { effectiveType: '4g' })
    expect(networkSourceOf(window.navigator)).toEqual({ online: true, effectiveType: '4g' })
  })

  it('掉线（onLine=false）仍返回读数：online 只是读数翻转，不隐藏', () => {
    grantCapability('connection', { effectiveType: '3g' })
    // jsdom 的 onLine 在原型 getter 上——用实例 own 属性遮蔽，finally 删掉即还原。
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    try {
      expect(networkSourceOf(window.navigator)).toEqual({ online: false, effectiveType: '3g' })
    } finally {
      Reflect.deleteProperty(window.navigator, 'onLine')
    }
  })

  it('effectiveType 缺失或非字符串 → null（读不到的细节不画）', () => {
    grantCapability('connection', {})
    expect(networkSourceOf(window.navigator)).toBeNull()
    grantCapability('connection', { effectiveType: 42 })
    expect(networkSourceOf(window.navigator)).toBeNull()
  })
})
