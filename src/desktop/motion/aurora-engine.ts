/**
 * 流光渐变氛围引擎（motion-lab enhance-advanced/aurora → 产品归档，
 * docs/DESIGN.md §32.5 修订 10）：光斑预烘焙成离屏精灵、每帧只 drawImage
 * 合成；半分辨率绘制天然柔边。性能口径：单 rAF 循环、document.hidden 暂停、
 * dpr 上限 2、内部分辨率 × renderScale(0.5)、帧率上限 30fps；reduced-motion
 * 只渲染一帧静态氛围。光斑布局由固定种子 LCG 生成（刷新一致，可回归）。
 */

/** 模块动效参数（与 motion-lab aurora.js PARAMS 同值归档）。 */
export const AURORA_PARAMS = {
  maxDpr: 2,
  renderScale: 0.5,
  blobCount: 4,
  radiusMin: 0.3,
  radiusMax: 0.55,
  coreAlpha: 0.85,
  alphaLight: 0.2,
  alphaDark: 0.34,
  speed: 0.05,
  orbitMin: 0.05,
  orbitMax: 0.14,
  fpsCap: 30,
  colorsLight: ['#2f5fe8', '#7fa4ff', '#9db9ff', '#c9d9ff'],
  colorsDark: ['#2f5fe8', '#82a3ff', '#4fd2ff', '#8a7bff'],
} as const

/** 固定种子 LCG（与实验室同种子同常数：布局逐次一致）。 */
export function createAuroraRandom(seed = 20260926): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export interface AuroraBlob {
  bx: number
  by: number
  r: number
  orbit: number
  sm: number
  ph: number
  a: number
}

/** 光斑运动参数布局（确定性：同 rnd 序列同布局）。 */
export function buildBlobLayout(count: number, rnd: () => number): AuroraBlob[] {
  const blobs: AuroraBlob[] = []
  for (let i = 0; i < count; i++) {
    blobs.push({
      bx: 0.12 + rnd() * 0.76,
      by: 0.15 + rnd() * 0.7,
      r: AURORA_PARAMS.radiusMin + rnd() * (AURORA_PARAMS.radiusMax - AURORA_PARAMS.radiusMin),
      orbit: AURORA_PARAMS.orbitMin + rnd() * (AURORA_PARAMS.orbitMax - AURORA_PARAMS.orbitMin),
      sm: 0.6 + rnd() * 0.8,
      ph: rnd() * Math.PI * 2,
      a: 0.5 + rnd() * 0.5,
    })
  }
  return blobs
}

export interface BlobPose {
  x: number
  y: number
  r: number
}

/** 单光斑在画布 t 秒时刻的位置/半径（双轴异相椭圆轨道 + 半径轻呼吸）。 */
export function blobPose(blob: AuroraBlob, t: number, width: number, height: number): BlobPose {
  const m = Math.min(width, height)
  return {
    x: (blob.bx + Math.cos(t * AURORA_PARAMS.speed * blob.sm + blob.ph) * blob.orbit) * width,
    y:
      (blob.by + Math.sin(t * AURORA_PARAMS.speed * blob.sm * 0.83 + blob.ph * 1.7) * blob.orbit) *
      height,
    r: blob.r * m * (1 + 0.08 * Math.sin(t * AURORA_PARAMS.speed * 0.5 + blob.ph * 3)),
  }
}
