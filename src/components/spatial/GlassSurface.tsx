import type { CSSProperties, ReactNode } from 'react'

/**
 * 空间玻璃面壳（空间化地基切片，2026-10-10）：纯展示玻璃壳——不接任何
 * store，全部 props 驱动；材质来自 spatial.css 的 --sp-* 独立低透明档
 * （不回调 chrome 白玻璃 8% 裁决），降级兜底在样式文件内自持源序。
 * - depth：深度档（translateZ 走 --sp-lift-*，near 档附加 scale 1.02；
 *   视觉位移需要消费方侧以 --sp-perspective 建立舞台 3D 上下文）。
 * - float：常驻环境浮动（sp-float 关键帧，只动 transform，9s 周期）。
 * - motionStatic：motion-prefs 空间动效关档时的直切类——与浮动类共存，
 *   由 spatial.css 源序保证 animation: none 必胜（与 mobile 静态类同
 *   口径）；prefers-reduced-motion 另由 index.css 全局塌缩覆盖。
 * 空间视觉效果仅桌面作用域；移动端 §35 玻璃白名单五处不扩。
 */
export type SpatialDepth = 'near' | 'middle' | 'far'

const DEPTH_CLASS: Record<SpatialDepth, string> = {
  near: 'sp-depth-near',
  middle: 'sp-depth-middle',
  far: 'sp-depth-far',
}

export interface GlassSurfaceProps {
  depth?: SpatialDepth
  float?: boolean
  motionStatic?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function GlassSurface({
  depth,
  float = false,
  motionStatic = false,
  className,
  style,
  children,
}: GlassSurfaceProps) {
  const classes = ['spatial-window']
  if (depth) classes.push(DEPTH_CLASS[depth])
  if (float) classes.push('sp-ambient-float')
  if (motionStatic) classes.push('sp-motion-static')
  if (className) classes.push(className)

  return (
    <div className={classes.join(' ')} style={style}>
      {children}
    </div>
  )
}
