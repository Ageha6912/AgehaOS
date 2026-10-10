import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SWIPE_UP_CONFIG,
  classifyVerticalDrag,
  isBottomOrigin,
  shouldConfirmSwipeUp,
  swipeUpTranslation,
  upwardDisplacement,
} from './swipe-up-decision'

/**
 * 上滑唤起启动器判定纯函数契约（M3-1；hook 采集归 use-swipe-up.test.tsx，
 * Shell 接线归 MobileShell.test.tsx，真实触控时序归 e2e
 * mobile-swipe-up-launcher.spec.ts）。默认档：底缘带 72px / 距离 0.15 视口高
 * / 甩动 0.5px/ms / 死区 10px / 跟手上限 80px。
 */

const VIEWPORT = { width: 360, height: 800 }
const CONFIG = DEFAULT_SWIPE_UP_CONFIG

describe('isBottomOrigin（底缘激活带）', () => {
  it('距底边 ≤72px 的起点在带内：预留带（y=795）与 Dock 下半（y=740）都在', () => {
    expect(isBottomOrigin({ x: 180, y: 795 }, VIEWPORT, CONFIG)).toBe(true)
    expect(isBottomOrigin({ x: 0, y: 740 }, VIEWPORT, CONFIG)).toBe(true)
    expect(isBottomOrigin({ x: 180, y: 728 }, VIEWPORT, CONFIG)).toBe(true) // 恰好 72
  })

  it('带外起点（Dock 上沿之上 / 内容区）不激活', () => {
    expect(isBottomOrigin({ x: 180, y: 727 }, VIEWPORT, CONFIG)).toBe(false)
    expect(isBottomOrigin({ x: 180, y: 400 }, VIEWPORT, CONFIG)).toBe(false)
    expect(isBottomOrigin({ x: 180, y: 0 }, VIEWPORT, CONFIG)).toBe(false)
  })

  it('edgeWidth 参数化：缩窄激活带只认更贴底的起点', () => {
    expect(isBottomOrigin({ x: 180, y: 770 }, VIEWPORT, { ...CONFIG, edgeWidth: 40 })).toBe(true)
    expect(isBottomOrigin({ x: 180, y: 750 }, VIEWPORT, { ...CONFIG, edgeWidth: 40 })).toBe(false)
  })
})

describe('upwardDisplacement（上滑位移，向上为正）', () => {
  it('向上拖为正、向下拖为负、原地为 0', () => {
    expect(upwardDisplacement({ x: 10, y: 780 }, { x: 10, y: 630 })).toBe(150)
    expect(upwardDisplacement({ x: 10, y: 780 }, { x: 10, y: 800 })).toBe(-20)
    expect(upwardDisplacement({ x: 10, y: 780 }, { x: 10, y: 780 })).toBe(0)
  })
})

describe('classifyVerticalDrag（轴向裁决）', () => {
  it('死区内（≤10px 总位移）= undecided：Dock 位点击照常，手势不抢', () => {
    expect(classifyVerticalDrag({ x: 10, y: 780 }, { x: 12, y: 784 }, CONFIG)).toBe('undecided')
    expect(classifyVerticalDrag({ x: 10, y: 780 }, { x: 10, y: 790 }, CONFIG)).toBe('undecided')
  })

  it('上滑分量为主 = upward：横向微漂不夺轴', () => {
    expect(classifyVerticalDrag({ x: 10, y: 780 }, { x: 14, y: 680 }, CONFIG)).toBe('upward')
    expect(classifyVerticalDrag({ x: 10, y: 780 }, { x: 10, y: 630 }, CONFIG)).toBe('upward')
  })

  it('横向为主 = reject：Dock 带内横向拖拽不唤起', () => {
    expect(classifyVerticalDrag({ x: 10, y: 780 }, { x: 120, y: 770 }, CONFIG)).toBe('reject')
  })

  it('向下拖 = reject（位移为负永不激活）', () => {
    expect(classifyVerticalDrag({ x: 10, y: 760 }, { x: 10, y: 790 }, CONFIG)).toBe('reject')
  })
})

describe('shouldConfirmSwipeUp（距离档或甩动档满足其一）', () => {
  it('距离档：位移 > 视口高 × 0.15（800 高 = 120px）即确认', () => {
    expect(shouldConfirmSwipeUp({ upwardPx: 121, velocity: 0, viewport: VIEWPORT }, CONFIG)).toBe(true)
    expect(shouldConfirmSwipeUp({ upwardPx: 120, velocity: 0, viewport: VIEWPORT }, CONFIG)).toBe(false)
  })

  it('距离不足但快速上甩（≥0.5px/ms）同样确认', () => {
    expect(shouldConfirmSwipeUp({ upwardPx: 60, velocity: 0.5, viewport: VIEWPORT }, CONFIG)).toBe(true)
    expect(shouldConfirmSwipeUp({ upwardPx: 60, velocity: 0.49, viewport: VIEWPORT }, CONFIG)).toBe(false)
  })

  it('confirmRatio 参数化：比例升高抬高距离门槛', () => {
    const strict = { ...CONFIG, confirmRatio: 0.5 }
    expect(shouldConfirmSwipeUp({ upwardPx: 300, velocity: 0, viewport: VIEWPORT }, strict)).toBe(false)
    expect(shouldConfirmSwipeUp({ upwardPx: 401, velocity: 0, viewport: VIEWPORT }, strict)).toBe(true)
  })
})

describe('swipeUpTranslation（跟手位移钳制）', () => {
  it('1:1 跟手，钳到 [0, followMaxPx=80]：负位移与超顶都不越界', () => {
    expect(swipeUpTranslation(0, CONFIG)).toBe(0)
    expect(swipeUpTranslation(30, CONFIG)).toBe(30)
    expect(swipeUpTranslation(-15, CONFIG)).toBe(0)
    expect(swipeUpTranslation(400, CONFIG)).toBe(80)
  })
})
