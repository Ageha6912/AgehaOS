/**
 * WCAG 相对亮度与对比度（设计文档 §6.2 硬约束、§4.4 质量门）。
 * 全部为纯函数，可在参数空间（渲染前）完成校验。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const int = parseInt(match[1], 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

/** WCAG 相对亮度（0 黑 – 1 白）。 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 对比度（≥1，≤21）。入参任一为非法 hex 时返回 null。 */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return null
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 将前景色按不透明度 α 混入背景色（渐变遮罩 scrim 的数学等价）。 */
export function blendHex(fg: string, bg: string, alpha: number): string | null {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  if (!f || !b) return null
  const mix = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha))
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  return `#${toHex(mix(f.r, b.r))}${toHex(mix(f.g, b.g))}${toHex(mix(f.b, b.b))}`
}

/** 平均相对亮度（§4.4「四角与中心平均亮度」在参数空间的近似：对渐变 stops 取均值）。 */
export function averageBrightness(stops: string[]): number | null {
  if (stops.length === 0) return null
  let total = 0
  for (const stop of stops) {
    const rgb = hexToRgb(stop)
    if (!rgb) return null
    total += relativeLuminance(rgb)
  }
  return total / stops.length
}
