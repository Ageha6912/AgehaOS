import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DOCK_HOME_GESTURE_CONFIG,
  holdExceedsSlop,
  isHomeSwipeUp,
} from './dock-home-gesture'

/**
 * M3-2 Dock Home 位手势判定纯函数（判定阈值唯一来源；hook 时序归
 * use-dock-home-gesture.test.tsx）：死区取消长按 / 上滑过阈且上滑为主。
 */

describe('dock-home-gesture（Dock Home 位手势判定）', () => {
  describe('holdExceedsSlop（出死区取消长按）', () => {
    const start = { x: 36, y: 760 }

    it('死区内（含点击抖动）不取消', () => {
      expect(holdExceedsSlop(start, start, DEFAULT_DOCK_HOME_GESTURE_CONFIG)).toBe(false)
      expect(
        holdExceedsSlop(start, { x: 38, y: 762 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG),
      ).toBe(false)
    })

    it('位移出死区（任意方向）取消', () => {
      // 纵向下拖（误触滚动方向也该取消长按）。
      expect(
        holdExceedsSlop(start, { x: 36, y: 775 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG),
      ).toBe(true)
      // 横向拖向相邻位。
      expect(
        holdExceedsSlop(start, { x: 52, y: 760 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG),
      ).toBe(true)
      // 上滑（切换成上滑判定的路径，长按必须先撤）。
      expect(
        holdExceedsSlop(start, { x: 36, y: 740 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG),
      ).toBe(true)
    })

    it('死区边界本身不算出（严格大于）', () => {
      const edge = { x: start.x, y: start.y - DEFAULT_DOCK_HOME_GESTURE_CONFIG.moveSlopPx }
      expect(holdExceedsSlop(start, edge, DEFAULT_DOCK_HOME_GESTURE_CONFIG)).toBe(false)
    })
  })

  describe('isHomeSwipeUp（上滑开最近任务）', () => {
    const start = { x: 36, y: 770 }

    it('上滑超过 swipeUpPx 且上滑为主 → 确认', () => {
      expect(isHomeSwipeUp(start, { x: 36, y: 700 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG)).toBe(true)
    })

    it('位移不足阈值 → 不确认（点击抖动、微滑都放回 click 路径）', () => {
      expect(isHomeSwipeUp(start, { x: 36, y: 755 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG)).toBe(false)
      expect(isHomeSwipeUp(start, start, DEFAULT_DOCK_HOME_GESTURE_CONFIG)).toBe(false)
    })

    it('上滑为主但幅度小于横向分量（斜拖）→ 不确认', () => {
      // 上滑 30px、横向 60px：上滑不是主分量，横向归 Dock 位原生指针语义。
      expect(
        isHomeSwipeUp(start, { x: start.x + 60, y: start.y - 30 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG),
      ).toBe(false)
    })

    it('向下拖 → 不确认（向上为正方向）', () => {
      expect(
        isHomeSwipeUp(start, { x: 36, y: start.y + 80 }, DEFAULT_DOCK_HOME_GESTURE_CONFIG),
      ).toBe(false)
    })

    it('阈值边界本身不算过（严格大于）', () => {
      const edge = { x: start.x, y: start.y - DEFAULT_DOCK_HOME_GESTURE_CONFIG.swipeUpPx }
      expect(isHomeSwipeUp(start, edge, DEFAULT_DOCK_HOME_GESTURE_CONFIG)).toBe(false)
    })
  })
})
