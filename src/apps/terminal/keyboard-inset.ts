/**
 * 软键盘遮挡计算（M3-5 Terminal 窄容器适配，可单测纯函数）：布局视口高
 * 减 visualViewport 可视段（offsetTop + height）= 被软键盘盖住的高度。
 * 读数异常（非正数）回 0 绝不抛错（M0-1 能力探针同款纪律）；键盘未遮挡
 * （可视段覆盖全视口）同样回 0。
 */
export function keyboardInsetPx(
  innerHeight: number,
  visual: { offsetTop: number; height: number },
): number {
  if (!(innerHeight > 0) || !(visual.height > 0)) return 0
  return Math.max(0, innerHeight - visual.offsetTop - visual.height)
}
