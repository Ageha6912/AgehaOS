import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RECENTS_CARD_CONFIG,
  recentsCardTranslation,
  shouldDismissRecentsCard,
} from './recents-card-decision'

/**
 * M3-2 最近任务卡片上滑关闭判定纯函数（hook 时序归
 * use-recents-card-dismiss.test.tsx；轴向裁决复用 swipe-up-decision 的
 * classifyVerticalDrag，其单测在 gesture 目录）。
 */

describe('recents-card-decision（卡片上滑关闭判定）', () => {
  describe('shouldDismissRecentsCard', () => {
    it('距离档：上滑超过 dismissPx 确认', () => {
      expect(
        shouldDismissRecentsCard(
          { upwardPx: DEFAULT_RECENTS_CARD_CONFIG.dismissPx + 1, velocity: 0 },
          DEFAULT_RECENTS_CARD_CONFIG,
        ),
      ).toBe(true)
    })

    it('速度档：慢拖未过距离但释放速度达标即确认（甩动）', () => {
      expect(
        shouldDismissRecentsCard(
          { upwardPx: 20, velocity: DEFAULT_RECENTS_CARD_CONFIG.confirmVelocity },
          DEFAULT_RECENTS_CARD_CONFIG,
        ),
      ).toBe(true)
    })

    it('双档都不满足 → 不确认（回弹）', () => {
      expect(
        shouldDismissRecentsCard(
          {
            upwardPx: DEFAULT_RECENTS_CARD_CONFIG.dismissPx,
            velocity: DEFAULT_RECENTS_CARD_CONFIG.confirmVelocity - 0.01,
          },
          DEFAULT_RECENTS_CARD_CONFIG,
        ),
      ).toBe(false)
    })
  })

  describe('recentsCardTranslation（跟手钳制）', () => {
    it('1:1 跟手，负位移归零（向下不产生上移），超顶钳在 followMaxPx', () => {
      expect(recentsCardTranslation(40, DEFAULT_RECENTS_CARD_CONFIG)).toBe(40)
      expect(recentsCardTranslation(-30, DEFAULT_RECENTS_CARD_CONFIG)).toBe(0)
      expect(
        recentsCardTranslation(
          DEFAULT_RECENTS_CARD_CONFIG.followMaxPx + 500,
          DEFAULT_RECENTS_CARD_CONFIG,
        ),
      ).toBe(DEFAULT_RECENTS_CARD_CONFIG.followMaxPx)
    })
  })
})
