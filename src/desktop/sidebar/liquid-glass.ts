import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * system-rails「液态玻璃」（2026-10-02 用户裁决，ZenDesktop 观感的 Web 原创
 * 复刻）：左栏组的折射效果由 SVG feDisplacementMap 承担——位移图在运行时
 * 以 canvas 生成，PNG 的 R/G 通道分别编码 X/Y 方向位移（128 为中性），
 * 圆角矩形边缘带内按平滑曲线沿外法线推挤（玻璃边缘折射观感）。
 *
 * jsdom 无 canvas（坑：getContext 返回 null）或组尺寸过小时返回空串，
 * 调用方回落常规毛玻璃（.glass-raise）。
 */

export interface LiquidMapOptions {
  width: number
  height: number
  /** 圆角半径（与组容器 rounded-xl 的 20px 对齐）。 */
  radius: number
  /** 边缘折射带厚度（px）：折射集中在最外缘 band 内。 */
  band: number
  /** 折射强度（边缘最大位移，px）。 */
  strength: number
}

/** 默认参数：带 14px、强度 10px、圆角 20px——观感对标 Windows 液态玻璃。 */
export const LIQUID_MAP_DEFAULTS: LiquidMapOptions = {
  width: 176,
  height: 520,
  radius: 20,
  band: 14,
  strength: 10,
}

/**
 * 圆角矩形 SDF（signed distance）：内部为负、外部为正、边界为 0。
 * 标准公式：min(max(qx,qy),0) + length(max(qx,0),max(qy,0)) − r。
 */
export function roundedRectSDF(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
): number {
  const qx = Math.abs(px - width / 2) - (width / 2 - radius)
  const qy = Math.abs(py - height / 2) - (height / 2 - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return Math.min(Math.max(qx, qy), 0) + outside - radius
}

/**
 * 边缘带内的折射曲线：t ∈ [0,1]（0=带内界，1=最外缘），返回 0→1 的
 * smoothstep 平滑爬升——折射集中在最外缘且无突跳。
 */
export function edgeCurve(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/**
 * (px,py) 处的位移向量（px，沿外法线）：带外为 0；带内按 edgeCurve 放大。
 * t = 1 + d/band（d ≤ 0）：最外缘 t=1 → 全强度，带内界 t=0 → 0。
 */
export function displacementAt(
  px: number,
  py: number,
  o: LiquidMapOptions,
): { dx: number; dy: number } {
  const d = roundedRectSDF(px, py, o.width, o.height, o.radius)
  if (d >= 0 || -d > o.band) return { dx: 0, dy: 0 }
  const k = edgeCurve(1 + d / o.band)
  // 外法线：角区取对角方向，边区取轴向。
  const qx = Math.abs(px - o.width / 2) - (o.width / 2 - o.radius)
  const qy = Math.abs(py - o.height / 2) - (o.height / 2 - o.radius)
  const sx = px < o.width / 2 ? -1 : 1
  const sy = py < o.height / 2 ? -1 : 1
  let nx = 0
  let ny = 0
  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy) || 1
    nx = (qx / len) * sx
    ny = (qy / len) * sy
  } else if (qx > qy) {
    nx = sx
  } else {
    ny = sy
  }
  return { dx: nx * o.strength * k, dy: ny * o.strength * k }
}

/**
 * 生成位移图 PNG data URI：R = 128 + dx、G = 128 + dy（feDisplacementMap 的
 * (v/255 − 0.5) 口径；调用方 scale = 2 × strength 时位移逐像素精确）。
 * 无 canvas 环境（jsdom）返回空串。
 */
export function buildDisplacementMapDataUri(o: LiquidMapOptions): string {
  const canvas = document.createElement('canvas')
  canvas.width = o.width
  canvas.height = o.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const image = ctx.createImageData(o.width, o.height)
  for (let py = 0; py < o.height; py += 1) {
    for (let px = 0; px < o.width; px += 1) {
      const { dx, dy } = displacementAt(px + 0.5, py + 0.5, o)
      const i = (py * o.width + px) * 4
      image.data[i] = Math.max(0, Math.min(255, Math.round(128 + (dx * 255) / (2 * o.strength))))
      image.data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + (dy * 255) / (2 * o.strength))))
      image.data[i + 2] = 128
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * 测量 ref 指向的组容器并生成位移图（挂载后延迟一拍测量，坑 62 的
 * 「测量进 effect、结果延迟进 state」合规格式）。组过小/无 canvas → ''。
 */
export function useLiquidDisplacementMap(
  ref: RefObject<HTMLElement | null>,
  overrides?: Partial<Omit<LiquidMapOptions, 'width' | 'height'>>,
): string {
  const [mapUri, setMapUri] = useState('')
  const latest = useRef<Partial<Omit<LiquidMapOptions, 'width' | 'height'>> | undefined>(undefined)
  latest.current = overrides
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 80) return
      const uri = buildDisplacementMapDataUri({
        ...LIQUID_MAP_DEFAULTS,
        ...latest.current,
        width: Math.min(Math.round(rect.width), 256),
        height: Math.min(Math.round(rect.height), 640),
      })
      if (uri) setMapUri(uri)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [ref])
  return mapUri
}
