/** 波浪参数（2026-10-05 用户裁决终态：波浪是 Dock 唯一浮起）：σ 对齐图标
    节距 56px，峰值轻浮 8px / scale 1.08——作用于距指针最近的一枚。 */
export const DOCK_WAVE_SIGMA_PX = 56
export const DOCK_WAVE_MAX_LIFT_PX = 8
export const DOCK_WAVE_MAX_SCALE = 1.08

/** 高斯邻位波浪：|距离| → inline transform（超出 2σ 返回 null = 回落基态，
    不写样式）。纯函数，jsdom 可测。独立成文件以满足 react-refresh
    （组件文件只导出组件）。 */
export function dockWaveTransform(distancePx: number): string | null {
  const t = Math.exp(-(distancePx * distancePx) / (DOCK_WAVE_SIGMA_PX * DOCK_WAVE_SIGMA_PX))
  if (t < 0.02) return null
  const scale = 1 + (DOCK_WAVE_MAX_SCALE - 1) * t
  return `translateY(${(-DOCK_WAVE_MAX_LIFT_PX * t).toFixed(2)}px) scale(${scale.toFixed(4)})`
}
