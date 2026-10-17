/**
 * 文件预览的图片侧纯函数（image-preview UI 的可测内核）：
 * 扩展名判定、字节→data URL、以及光标不动点缩放仿射。
 */

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/** 按扩展名判定图片文件并给出 MIME；未知扩展名返回 null（走文本路径）。 */
export function imageMimeFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MIME_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * 字节负载 → data URL（分块拼二进制串，避免大图触发 btoa 的调用栈上限）。
 * SVG 经 <img> 呈现时浏览器不执行其内嵌脚本，安全。
 */
export function bytesToImageDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

export interface ImageZoomState {
  scale: number
  /** 平移量（px，容器坐标；配合 transform-origin: center 的缩放）。 */
  tx: number
  ty: number
}

export interface ZoomAtOptions {
  /** 缩放系数（滚轮 = e^-Δy·k；按钮 = 固定步进）。 */
  factor: number
  /** 缩放锚点（容器坐标；光标不动点=光标位置，按钮=容器中心）。 */
  originX: number
  originY: number
  /** 容器中心（transform-origin: center 的不动点基准）。 */
  centerX: number
  centerY: number
  minScale: number
  maxScale: number
}

/**
 * 光标不动点仿射缩放：以 origin 为锚放大 factor 后，锚点指向的内容像素
 * 保持不动。推导（transform-origin: center，t 为平移）：内容点
 * p = (m − C − t)/s，缩放后 t' = m − C − (s'/s)(m − C − t)。
 * 撞到 min/max 边界时按实际比值折算平移，不会漂移。
 */
export function zoomAt(state: ImageZoomState, options: ZoomAtOptions): ImageZoomState {
  const next = Math.min(options.maxScale, Math.max(options.minScale, state.scale * options.factor))
  if (next === state.scale) return state
  const f = next / state.scale
  return {
    scale: next,
    tx: options.originX - options.centerX - f * (options.originX - options.centerX - state.tx),
    ty: options.originY - options.centerY - f * (options.originY - options.centerY - state.ty),
  }
}
