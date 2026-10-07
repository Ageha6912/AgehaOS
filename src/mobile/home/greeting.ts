import type { MessageKey } from '@/core/i18n'

/**
 * 移动 Home 时段问候分档（M1-1）：纯函数、可单测——不读系统时间，入参
 * 就是小时数。分档边界刻意与桌面动态情境引擎的时段口径（core/dynamic/
 * generative/seed 的 timePhaseOf：5/11/17/22 四相）保持同源，仅把「夜相
 * （22–次日 5 点）」并入「晚上」档——移动 Home 的问候只有早/午/晚三档
 * 文案，深夜不需要单独的「夜深了」语态（口径见词典 mobile.home.greeting.*）。
 *
 * 边界（左闭右开，24 小时制本地时间）：
 * - morning   [5, 11)  早上好
 * - afternoon [11, 17) 下午好
 * - evening   其余（[17, 24) ∪ [0, 5)）晚上好
 */

/** 问候三档：morning / afternoon / evening（夜里并入 evening）。 */
export type MobileGreetingPhase = 'morning' | 'afternoon' | 'evening'

export function mobileGreetingPhase(hour: number): MobileGreetingPhase {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  return 'evening'
}

/** 问候档 → 词典键（文案归 i18n 双词典，零硬编码）。 */
export function greetingPhaseKey(phase: MobileGreetingPhase): MessageKey {
  return `mobile.home.greeting.${phase}`
}

/** 问候语与用户名之间的连接符键（zh「，」/ en ", "，与桌面 greetingJoin 同口径）。 */
export function greetingJoinKey(): MessageKey {
  return 'mobile.home.greeting.join'
}
