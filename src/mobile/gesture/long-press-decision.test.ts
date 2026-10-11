import { describe, expect, it } from 'vitest'

import { DEFAULT_LONG_PRESS_CONFIG, exceedsMoveTolerance, isLongPressDwell } from './long-press-decision'

/**
 * 长按判定纯函数契约（M3-6；hook 集成归 use-long-press.test.tsx，真实触控
 * 时序归 e2e/mobile-files.spec.ts 长按操作单用例）。
 */

describe('DEFAULT_LONG_PRESS_CONFIG', () => {
  it('默认档 = 500ms 驻留 + 10px 位移容忍（冻结，防运行期改阈值）', () => {
    expect(DEFAULT_LONG_PRESS_CONFIG).toEqual({ thresholdMs: 500, moveTolerancePx: 10 })
    expect(Object.isFrozen(DEFAULT_LONG_PRESS_CONFIG)).toBe(true)
  })
})

describe('isLongPressDwell', () => {
  it('阈值内（<500ms）不确认：阈值内抬起 = 正常点击', () => {
    expect(isLongPressDwell(0, DEFAULT_LONG_PRESS_CONFIG)).toBe(false)
    expect(isLongPressDwell(120, DEFAULT_LONG_PRESS_CONFIG)).toBe(false)
    expect(isLongPressDwell(499, DEFAULT_LONG_PRESS_CONFIG)).toBe(false)
  })

  it('恰好到阈与超阈确认', () => {
    expect(isLongPressDwell(500, DEFAULT_LONG_PRESS_CONFIG)).toBe(true)
    expect(isLongPressDwell(2000, DEFAULT_LONG_PRESS_CONFIG)).toBe(true)
  })

  it('阈值参数化：自定义档按自定义值裁决', () => {
    const config = { thresholdMs: 300, moveTolerancePx: 10 }
    expect(isLongPressDwell(299, config)).toBe(false)
    expect(isLongPressDwell(300, config)).toBe(true)
  })
})

describe('exceedsMoveTolerance', () => {
  it('死区内（≤10px 直线距离）不取消：驻留继续计时', () => {
    const start = { x: 100, y: 300 }
    expect(exceedsMoveTolerance(start, { x: 100, y: 300 }, DEFAULT_LONG_PRESS_CONFIG)).toBe(false)
    expect(exceedsMoveTolerance(start, { x: 106, y: 308 }, DEFAULT_LONG_PRESS_CONFIG)).toBe(false)
    expect(exceedsMoveTolerance(start, { x: 110, y: 300 }, DEFAULT_LONG_PRESS_CONFIG)).toBe(false)
  })

  it('超限（>10px）取消：滚动/拖拽意图让位', () => {
    const start = { x: 100, y: 300 }
    expect(exceedsMoveTolerance(start, { x: 111, y: 300 }, DEFAULT_LONG_PRESS_CONFIG)).toBe(true)
    expect(exceedsMoveTolerance(start, { x: 108, y: 308 }, DEFAULT_LONG_PRESS_CONFIG)).toBe(true)
    // 纵向为主的位移同样超限（纵向滚动是本手势的主要冲突面）。
    expect(exceedsMoveTolerance(start, { x: 100, y: 320 }, DEFAULT_LONG_PRESS_CONFIG)).toBe(true)
  })

  it('容忍参数化：自定义档按自定义值裁决', () => {
    const config = { thresholdMs: 500, moveTolerancePx: 24 }
    expect(exceedsMoveTolerance({ x: 0, y: 0 }, { x: 24, y: 0 }, config)).toBe(false)
    expect(exceedsMoveTolerance({ x: 0, y: 0 }, { x: 25, y: 0 }, config)).toBe(true)
  })
})
