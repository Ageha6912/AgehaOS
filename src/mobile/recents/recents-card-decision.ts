import type { Point } from '../gesture/swipe-up-decision'

/**
 * 最近任务卡片上滑关闭判定纯函数（M3-2，MobileRecentsSheet 卡片手势）。
 *
 * 轴向裁决直接复用 swipe-up-decision.ts 的 classifyVerticalDrag /
 * upwardDisplacement（同一手势家族同一套轴向语义），本模块只补卡片尺度
 * 的确认与跟手两件：确认 = 固定 px 距离档**或**甩动速度档（卡片目标小，
 * 不用整屏手势的视口比例档）；跟手位移钳一个卡片高度余量。
 */

export interface RecentsCardConfig {
  /** 距离确认阈值（px）：上滑位移超过它即确认（约一个卡片高度）。 */
  dismissPx: number
  /** 甩动确认速度阈值（px/ms，0.5 ≈ 500px/s，与边缘返回/上滑唤起同档）。 */
  confirmVelocity: number
  /** 跟手位移上限（px）：卡片随手上移的钳制值，超顶不再放大。 */
  followMaxPx: number
}

export const DEFAULT_RECENTS_CARD_CONFIG: Readonly<RecentsCardConfig> = Object.freeze({
  dismissPx: 64,
  confirmVelocity: 0.5,
  followMaxPx: 120,
})

/** 确认判定入参：上滑位移（upwardDisplacement 的输出）+ 实测释放速度。 */
export interface RecentsCardSample {
  upwardPx: number
  velocity: number
}

/** 距离档或甩动档满足其一即确认关闭（释放时一次求出，判定不入 render）。 */
export function shouldDismissRecentsCard(
  sample: RecentsCardSample,
  config: RecentsCardConfig,
): boolean {
  return sample.upwardPx > config.dismissPx || sample.velocity >= config.confirmVelocity
}

/** 跟手位移（px）：1:1 原始上滑位移，钳到 [0, followMaxPx]——负位移（向下）
 * 不产生上移，超顶不再放大。 */
export function recentsCardTranslation(upwardPx: number, config: RecentsCardConfig): number {
  return Math.min(Math.max(upwardPx, 0), config.followMaxPx)
}

export type { Point }
