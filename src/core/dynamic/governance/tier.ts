import type { HardwareTier } from '../types'

/**
 * 硬件三档判据（设计文档 §7.1）与降级阈值（§7.3）。
 * 判据纯函数化：deviceMemory / hardwareConcurrency / WebGL2 / 合成基准 FPS 均可注入 mock（验收 ⑤）。
 */

export interface TierSignals {
  /** GB；navigator.deviceMemory，未知传 undefined。 */
  deviceMemory?: number
  /** navigator.hardwareConcurrency，未知传 undefined。 */
  hardwareConcurrency?: number
  /** WebGL2 可用性（PRD §31 能力探测）。 */
  hasWebGL2: boolean
  /** 启动合成基准 FPS（§7.1 ①：统一 60fps 目标的固定基准，<45fps 降一档）。 */
  measuredFps?: number
}

/** 启动合成基准的绝对阈值（区别于运行期按档相对阈值）。 */
export const BOOT_PROBE_FPS_THRESHOLD = 45

export function detectTier(signals: TierSignals): HardwareTier {
  const cores = signals.hardwareConcurrency
  const memory = signals.deviceMemory
  const lowByCores = cores !== undefined && cores <= 4
  const lowByMemory = memory !== undefined && memory <= 4
  const forcedLow = (cores !== undefined && cores <= 2) || (memory !== undefined && memory <= 4)
  let tier: HardwareTier
  if (forcedLow || ((lowByCores || lowByMemory) && !signals.hasWebGL2)) {
    tier = 'low'
  } else if (!signals.hasWebGL2 || (cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4)) {
    tier = 'mid'
  } else {
    tier = 'high'
  }
  // 启动降档（§7.3 第 5 级）：合成基准 <45fps 降一档。
  if (signals.measuredFps !== undefined && signals.measuredFps < BOOT_PROBE_FPS_THRESHOLD) {
    tier = tier === 'high' ? 'mid' : 'low'
  }
  return tier
}

/** 各档动画目标帧率（§7.2：高档 60fps、中档 30fps、低档禁动画）。 */
export const TIER_TARGET_FPS: Record<HardwareTier, number> = { high: 60, mid: 30, low: 0 }

/** 运行期降级阈值（§7.3）：相对档目标。 */
export const PAUSE_ANIMATION_RATIO = 0.75
export const SWITCH_STATIC_RATIO = 0.5
export const PAUSE_WINDOW_MS = 2000
export const STATIC_WINDOW_MS = 5000

export interface DegradeDecision {
  action: 'none' | 'pause-animation' | 'switch-static'
  measuredFps: number
}

/**
 * 按滚动窗口判定降级动作（§7.3 第 1–2 级）。
 * @param frameTimestamps 最近帧时间戳（升序，ms）。
 * @param now 当前时间（ms），可注入以保证可测。
 */
export function evaluateDegrade(
  tier: HardwareTier,
  frameTimestamps: number[],
  now: number,
): DegradeDecision {
  const target = TIER_TARGET_FPS[tier]
  if (target === 0 || frameTimestamps.length < 2) return { action: 'none', measuredFps: 0 }

  const windowAvgFps = (fromMs: number): number | null => {
    const inWindow = frameTimestamps.filter((t) => t >= now - fromMs)
    if (inWindow.length < 2) return null
    const span = now - inWindow[0]
    if (span <= 0) return null
    return ((inWindow.length - 1) * 1000) / span
  }

  const pauseAvg = windowAvgFps(PAUSE_WINDOW_MS)
  if (pauseAvg !== null && pauseAvg < target * PAUSE_ANIMATION_RATIO) {
    const staticAvg = windowAvgFps(STATIC_WINDOW_MS)
    if (staticAvg !== null && staticAvg < target * SWITCH_STATIC_RATIO) {
      return { action: 'switch-static', measuredFps: staticAvg }
    }
    return { action: 'pause-animation', measuredFps: pauseAvg }
  }
  const recent = windowAvgFps(PAUSE_WINDOW_MS)
  return { action: 'none', measuredFps: recent ?? 0 }
}
