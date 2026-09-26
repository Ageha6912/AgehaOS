/**
 * 开机进度引擎（motion-lab/boot/boot.js → 产品归档，docs/DESIGN.md §11）。
 *
 * rAF 四段变速推进（曲线见 src/core/boot/boot-curve.ts）+ 完成后退场编排。
 * 性能铁律：进度只写 transform: scaleX（合成层，禁 width 布局属性），每帧至多
 * 一次样式写 + 整数百分比变化时同步 aria；React 侧绕过渲染路径直写（60fps
 * 进度不进 setState），只在完成/收尾时回调一次。退场 will-change 仅在动画
 * 期间挂载。操作 DOM，故按集成指引放 src/desktop/ 而非 src/core/。
 */
import { bootCurve, clamp01 } from '@/core/boot/boot-curve'

/**
 * 开机总时长默认 2.2s：实验室演示的 3.8s 在产品里归档压缩（motion-lab README
 * §8.1 建议 2.5~3s），但 PRD §29.1「重载后 3s 内恢复可交互桌面」的预算含应用
 * 加载时间，2.5s+ 会顶穿——按「需求优先」归档为 2.2s。开机动画唯一时长豁免档
 * ——进度感来自内容本身（进度条推进），不受 300ms 铁律约束。
 */
export const BOOT_DURATION_MS = 2200
/** 退场（淡出 + 放大 1.05）时长：豁免档，对应归档令牌 --ag-motion-boot（400ms）。 */
export const BOOT_EXIT_MS = 400

/** 联调/测试钩子 window.AgehaBootConfig 的覆写钳制范围（越界自动收敛）。 */
const DURATION_RANGE = { min: 1000, max: 10000 } as const
const EXIT_RANGE = { min: 150, max: 5000 } as const

/** 后台标签页 rAF 暂停期间的单帧时间封顶：回前台不跳变。 */
const MAX_FRAME_MS = 100

/** 退场 setTimeout 兜底相对 transitionend 的追加余量。 */
const EXIT_FALLBACK_MARGIN_MS = 150

interface AgehaBootConfig {
  BOOT_DURATION_MS?: number
  exitDurationMs?: number
}

declare global {
  interface Window {
    AgehaBootConfig?: AgehaBootConfig
  }
}

function readConfigOverride(key: keyof AgehaBootConfig, range: { min: number; max: number }): number | undefined {
  const raw = window.AgehaBootConfig?.[key]
  const n = Number(raw)
  if (raw === undefined || raw === null || !Number.isFinite(n)) return undefined
  return Math.min(range.max, Math.max(range.min, Math.round(n)))
}

export interface BootMotionDom {
  /** 启动层根元素（data-boot 测试钩子与退场类挂这里）。 */
  root: HTMLElement
  /** 进度条填充元素（每帧写 transform: scaleX）。 */
  fill: HTMLElement
  /** 进度条轨道元素（同步 aria-valuenow，可选）。 */
  bar?: HTMLElement | null
}

export interface BootMotionCallbacks {
  /** 每次整数百分比推进回调 0~100（订阅瞬间不补发，只在推进时触发）。 */
  onProgress?: (percent: number) => void
  /** 进度到 100 时触发一次（skip 同样触发）。 */
  onComplete?: () => void
  /** 退场收尾（动画结束或 reduced 直接切换）后触发一次。 */
  onExitDone?: () => void
}

export interface BootMotionOptions {
  durationMs?: number
  exitDurationMs?: number
  /** 帧调度注入（测试用）；缺省 window.requestAnimationFrame。 */
  scheduleFrame?: (cb: (now: number) => void) => number
  cancelFrame?: (id: number) => void
}

export interface BootMotion {
  start(): void
  /** 立即跳到完成：进度置 100、触发完成回调并播退场（reduced 下直接切换）；幂等。 */
  skip(): void
  /** 摘除一切调度与监听；之后任何回调不再触发（StrictMode 卸载安全）。 */
  destroy(): void
  readonly durationMs: number
  readonly exitDurationMs: number
  /** 只读参考：分段变速曲线（t∈[0,1] → 进度 0~1），供联调与测试断言。 */
  progressAt: (t: number) => number
}

export function createBootMotion(
  dom: BootMotionDom,
  callbacks: BootMotionCallbacks = {},
  options: BootMotionOptions = {},
): BootMotion {
  const { root, fill, bar } = dom
  const scheduleFrame =
    options.scheduleFrame ?? ((cb: (now: number) => void) => window.requestAnimationFrame(cb))
  const cancelFrame = options.cancelFrame ?? ((id: number) => window.cancelAnimationFrame(id))

  const durationMs =
    options.durationMs ?? readConfigOverride('BOOT_DURATION_MS', DURATION_RANGE) ?? BOOT_DURATION_MS
  const exitDurationMs =
    options.exitDurationMs ?? readConfigOverride('exitDurationMs', EXIT_RANGE) ?? BOOT_EXIT_MS

  // prefers-reduced-motion（SPEC §5）：进度条照常推进（功能性反馈），
  // 但退场的缩放淡出动画关闭——直接切换。jsdom 等环境没有 matchMedia 时视为未开启。
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let started = false
  let done = false
  let destroyed = false
  let exitSettled = false
  let rafId = 0
  let lastTs: number | null = null
  let elapsed = 0
  let lastPercent = -1
  let exitTimer = 0

  function safeCall<A extends unknown[]>(cb: ((...args: A) => void) | undefined, ...args: A): void {
    // 单个回调抛错不允许打断启动流程
    try {
      cb?.(...args)
    } catch (err) {
      console.error('[AgehaBoot] 回调执行出错：', err)
    }
  }

  /** 写入进度：唯一逐帧样式写是 fill 的 scaleX；aria 与回调只在整数百分比变化时。 */
  function setProgress(p01: number): number {
    const clamped = clamp01(p01)
    fill.style.transform = `scaleX(${clamped.toFixed(4)})`
    const percent = Math.round(clamped * 100)
    if (percent !== lastPercent) {
      lastPercent = percent
      bar?.setAttribute('aria-valuenow', String(percent))
      safeCall(callbacks.onProgress, percent)
    }
    return percent
  }

  function tick(now: number): void {
    if (done || destroyed) return // 被 skip() 抢先后到达的旧帧直接丢弃
    if (lastTs !== null) elapsed += Math.min(now - lastTs, MAX_FRAME_MS)
    lastTs = now
    const t = Math.min(elapsed / durationMs, 1)
    setProgress(bootCurve(t))
    if (t >= 1) {
      finish()
    } else {
      rafId = scheduleFrame(tick)
    }
  }

  function start(): void {
    if (started || done || destroyed) return
    started = true
    rafId = scheduleFrame(tick)
  }

  /** 进度到 100：置测试钩子 → 触发完成回调（恰一次）→ 启动退场露出下层界面。 */
  function finish(): void {
    if (done || destroyed) return
    done = true
    cancelFrame(rafId)
    setProgress(1) // 确保进度精确到 100（触发最后一次进度回调）
    root.setAttribute('data-boot', 'complete')
    safeCall(callbacks.onComplete)
    startExit()
  }

  /** 退场：启动层淡出 + 放大（--ag-motion-boot 豁免档）；reduced 下直接切换。 */
  function startExit(): void {
    if (reducedMotion) {
      settleExit()
      return
    }
    root.classList.add('is-exiting')
    root.addEventListener('transitionend', onTransitionEnd, { once: true })
    // transitionend 为主、setTimeout 兜底（退场中标签页失焦导致事件丢失仍能收尾）
    exitTimer = window.setTimeout(settleExit, exitDurationMs + EXIT_FALLBACK_MARGIN_MS)
  }

  function onTransitionEnd(): void {
    settleExit()
  }

  function settleExit(): void {
    if (exitSettled || destroyed) return
    exitSettled = true
    root.removeEventListener('transitionend', onTransitionEnd)
    window.clearTimeout(exitTimer)
    root.hidden = true
    safeCall(callbacks.onExitDone)
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    cancelFrame(rafId)
    window.clearTimeout(exitTimer)
    root.removeEventListener('transitionend', onTransitionEnd)
  }

  return {
    start,
    skip: () => {
      if (!destroyed) finish()
    },
    destroy,
    get durationMs() {
      return durationMs
    },
    get exitDurationMs() {
      return exitDurationMs
    },
    progressAt: (t: number) => bootCurve(t),
  }
}
