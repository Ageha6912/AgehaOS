/**
 * 滚动边缘渐隐遮罩的停靠点生成（可测内核）。
 *
 * 7 档非线性渐隐（对齐 Claude Desktop 逆向验证的同款算法）：alpha 沿
 * (1−t)^1.5 幂律衰减，CSS 在相邻停靠点间线性插值——比两停靠点的线性
 * 渐变更贴合真实感知曲线，并避免高分屏上单段线性的色阶断层（banding）。
 * 颜色用 color-mix 在 --color-surface 上就地调 alpha，明暗两态自动跟随
 * 主题变量，无需为暗色另写一套停靠点。
 */

export const FADE_STOPS = 7

/** 幂律指数（y≈x^1.5，逆向实测拟合值）。 */
const FADE_GAMMA = 1.5

export type FadeDirection = 'to top' | 'to bottom'

/** 生成 7 档幂律渐变的 background-image 值（第 1 档不透明=贴边全遮）。 */
export function fadeGradient(direction: FadeDirection): string {
  const stops: string[] = []
  for (let i = 0; i < FADE_STOPS; i++) {
    const t = i / (FADE_STOPS - 1)
    const alpha = (1 - t) ** FADE_GAMMA
    stops.push(
      `color-mix(in srgb, var(--color-surface) ${(alpha * 100).toFixed(2)}%, transparent) ${(
        t * 100
      ).toFixed(2)}%`,
    )
  }
  return `linear-gradient(${direction}, ${stops.join(', ')})`
}
