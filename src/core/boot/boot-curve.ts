/**
 * 开机进度曲线（motion-lab/boot → 产品归档，docs/DESIGN.md §11）。
 *
 * 四段变速节奏：快（固件自检一把推上）→ 慢（内核与驱动爬坡）→ 平台期
 * （服务逐个就位）→ 冲刺（收尾冲线）。逐段独立缓动、全程严格单调不减，
 * 任何一点都不做匀速线性。纯函数、零 DOM，放 src/core/ 便于单测
 * （motion-lab README §8.1 集成指引）；DOM 侧引擎见 src/desktop/boot/boot-motion.ts。
 */

export interface BootSegment {
  /** 该段结束时的进度（0~1）。 */
  to: number
  /** 该段占总时长的时间占比；全部段的 share 合计必须为 1。 */
  share: number
  /** 段内缓动函数（输入输出都钳制在 0~1）。 */
  ease: (t: number) => number
  /** 节奏注释：这段模拟的真实加载阶段。 */
  note: string
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2
export const easeInCubic = (t: number): number => t * t * t

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

/** 产品默认分段（与 motion-lab/boot PARAMS.segments 同节奏，to 已归一化为 0~1）。 */
export const BOOT_SEGMENTS: readonly BootSegment[] = [
  { to: 0.36, share: 0.16, ease: easeOutCubic, note: '快：固件自检一把推上' },
  { to: 0.62, share: 0.36, ease: easeInOutSine, note: '慢：内核与驱动加载，缓慢爬坡' },
  { to: 0.8, share: 0.26, ease: easeInOutSine, note: '慢：服务逐个就位，接近停滞的平台期' },
  { to: 1, share: 0.22, ease: easeInCubic, note: '冲刺：收尾加速冲线' },
]

/**
 * 分段变速曲线：时间占比 t∈[0,1] → 进度 p∈[0,1]，全程单调不减。
 * t 越界自动钳制；自定义 segments 时最后一段兜底吞掉剩余时间。
 */
export function bootCurve(t: number, segments: readonly BootSegment[] = BOOT_SEGMENTS): number {
  const x = clamp01(t)
  let acc = 0
  let from = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (x <= acc + seg.share || i === segments.length - 1) {
      const local = clamp01((x - acc) / seg.share)
      return from + (seg.to - from) * seg.ease(local)
    }
    acc += seg.share
    from = seg.to
  }
  return 1
}
