import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootCurve } from '@/core/boot/boot-curve'

import {
  BOOT_DURATION_MS,
  BOOT_EXIT_MS,
  createBootMotion,
  type BootMotionCallbacks,
} from './boot-motion'

/**
 * 手动帧驱动测试台：rAF 调度被注入替换，测试用 h.fire(now) 逐帧推进，
 * 与 fake timers（退场 setTimeout 用）互不干扰——完全确定性。
 * 注意：引擎单帧封顶 100ms（后台标签页不跳变），大步长会被截断，
 * 推进时间必须用 ≤100ms 的步长；hasPendingFrame 是 getter，只能现读不可解构。
 */
function createHarness(callbacks: BootMotionCallbacks = {}, options = {}) {
  const root = document.createElement('div')
  const fill = document.createElement('div')
  const bar = document.createElement('div')
  bar.setAttribute('role', 'progressbar')
  root.append(fill, bar)
  document.body.appendChild(root)

  let pending: ((now: number) => void) | null = null
  const motion = createBootMotion(
    { root, fill, bar },
    callbacks,
    {
      ...options,
      scheduleFrame: (cb: (now: number) => void) => {
        pending = cb
        return 1
      },
      cancelFrame: () => {
        pending = null
      },
    },
  )
  return {
    dom: { root, fill, bar },
    motion,
    fire(now: number) {
      const cb = pending
      pending = null
      cb?.(now)
    },
    /** 以 ≤100ms 步长推进到目标时刻（封顶约束下的确定性推进）。 */
    fireUntil(now: number) {
      for (let ts = 0; ts <= now; ts += 100) this.fire(ts)
      if (now % 100 !== 0) this.fire(now)
    },
    get hasPendingFrame() {
      return pending !== null
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete window.AgehaBootConfig
  document.body.innerHTML = ''
})

describe('createBootMotion（开机进度引擎）', () => {
  it('uses the archived product durations by default', () => {
    expect(BOOT_DURATION_MS).toBe(2200)
    expect(BOOT_EXIT_MS).toBe(400)

    const { motion } = createHarness()
    expect(motion.durationMs).toBe(BOOT_DURATION_MS)
    expect(motion.exitDurationMs).toBe(400)
  })

  it('writes scaleX progress and syncs the integer aria-valuenow', () => {
    const percents: number[] = []
    const h = createHarness({ onProgress: (pct) => percents.push(pct) })
    h.motion.start()

    h.fire(0)
    expect(h.dom.fill.style.transform).toBe('scaleX(0.0000)')
    expect(h.dom.bar.getAttribute('aria-valuenow')).toBe('0')

    // 推进到 elapsed=260：期望值从纯曲线推导（曲线本身的数值断言归 boot-curve.test）。
    h.fire(100)
    h.fire(200)
    h.fire(260)
    const p260 = bootCurve(260 / BOOT_DURATION_MS)
    expect(h.dom.fill.style.transform).toBe(`scaleX(${p260.toFixed(4)})`)
    expect(h.dom.bar.getAttribute('aria-valuenow')).toBe(String(Math.round(p260 * 100)))
    // 单调不减、全整数、都在 0~100。
    expect(percents.length).toBeGreaterThan(1)
    percents.forEach((pct, i) => {
      expect(pct).toBeGreaterThanOrEqual(i === 0 ? 0 : percents[i - 1])
      expect(Number.isInteger(pct)).toBe(true)
      expect(pct).toBeGreaterThanOrEqual(0)
      expect(pct).toBeLessThanOrEqual(100)
    })
    expect(percents[0]).toBe(0)
  })

  it('completes exactly once at full duration and stops scheduling frames', () => {
    let completes = 0
    const h = createHarness({ onComplete: () => completes++ })
    h.motion.start()

    h.fireUntil(BOOT_DURATION_MS)
    expect(completes).toBe(1)
    expect(h.dom.root.getAttribute('data-boot')).toBe('complete')
    expect(h.dom.fill.style.transform).toBe('scaleX(1.0000)')
    expect(h.dom.bar.getAttribute('aria-valuenow')).toBe('100')

    // 完成后到达的旧帧与重复完成被守卫丢弃。
    h.fire(BOOT_DURATION_MS + 1000)
    expect(completes).toBe(1)
    expect(h.hasPendingFrame).toBe(false)
  })

  it('caps a single background frame at 100ms so returning to the tab does not jump', () => {
    const percents: number[] = []
    const h = createHarness({ onProgress: (pct) => percents.push(pct) })
    h.motion.start()

    h.fire(0)
    h.fire(5000) // 后台暂停 5s：只累计 100ms，进度不跳变。
    const expected = Math.round(bootCurve(100 / BOOT_DURATION_MS) * 100)
    expect(percents[percents.length - 1]).toBe(expected)
    expect(expected).toBeLessThan(30) // 远未完成
    expect(h.hasPendingFrame).toBe(true)
  })

  it('skips to completion idempotently and plays the exit', () => {
    let completes = 0
    const h = createHarness({ onComplete: () => completes++ })
    h.motion.start()

    h.motion.skip()
    h.motion.skip()
    expect(completes).toBe(1)
    expect(h.dom.root.getAttribute('data-boot')).toBe('complete')
    expect(h.dom.fill.style.transform).toBe('scaleX(1.0000)')
    expect(h.dom.root.classList.contains('is-exiting')).toBe(true)
  })

  it('settles the exit on transitionend without waiting for the timeout fallback', () => {
    let exits = 0
    const h = createHarness({ onExitDone: () => exits++ })
    h.motion.start()
    h.motion.skip()

    h.dom.root.dispatchEvent(new Event('transitionend'))
    expect(exits).toBe(1)
    expect(h.dom.root.hidden).toBe(true)

    // 兜底定时器之后触发也不会重复收尾。
    vi.advanceTimersByTime(1000)
    expect(exits).toBe(1)
  })

  it('settles the exit via the timeout fallback when transitionend is lost', () => {
    let exits = 0
    const h = createHarness({ onExitDone: () => exits++ })
    h.motion.start()
    h.motion.skip()

    vi.advanceTimersByTime(400 + 149)
    expect(exits).toBe(0)
    vi.advanceTimersByTime(1)
    expect(exits).toBe(1)
  })

  it('skips the exit animation under prefers-reduced-motion and settles immediately', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    let exits = 0
    const h = createHarness({ onExitDone: () => exits++ })
    h.motion.start()
    h.motion.skip()

    expect(exits).toBe(1)
    expect(h.dom.root.classList.contains('is-exiting')).toBe(false)
    expect(h.dom.root.hidden).toBe(true)
  })

  it('treats an absent matchMedia as non-reduced (jsdom-style environments)', () => {
    vi.stubGlobal('matchMedia', undefined)
    const h = createHarness()
    h.motion.start()
    h.motion.skip()

    expect(h.dom.root.classList.contains('is-exiting')).toBe(true)
  })

  it('clamps window.AgehaBootConfig overrides into the legal range', () => {
    window.AgehaBootConfig = { BOOT_DURATION_MS: 99999, exitDurationMs: 1 }
    const first = createHarness()
    expect(first.motion.durationMs).toBe(10000)
    expect(first.motion.exitDurationMs).toBe(150)

    delete window.AgehaBootConfig
    const fallback = createHarness()
    expect(fallback.motion.durationMs).toBe(BOOT_DURATION_MS)
  })

  it('ignores invalid config overrides and falls back to the defaults', () => {
    window.AgehaBootConfig = { BOOT_DURATION_MS: Number.NaN }
    const { motion } = createHarness()
    expect(motion.durationMs).toBe(BOOT_DURATION_MS)
  })

  it('destroy cancels frames, timers and listeners; callbacks never fire afterwards', () => {
    let completes = 0
    let exits = 0
    const h = createHarness({ onComplete: () => completes++, onExitDone: () => exits++ })
    h.motion.start()
    h.fire(0)
    h.motion.destroy()

    h.fire(2600)
    expect(completes).toBe(0)
    expect(h.dom.fill.style.transform).toBe('scaleX(0.0000)')

    h.motion.skip()
    expect(completes).toBe(0)
    vi.advanceTimersByTime(2000)
    expect(exits).toBe(0)
  })

  it('keeps the loop alive when a progress callback throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const percents: number[] = []
    const h = createHarness({
      onProgress: (pct) => {
        percents.push(pct)
        if (pct === 0) throw new Error('boom')
      },
    })
    h.motion.start()

    h.fire(0)
    h.fire(100)
    h.fire(200)
    h.fire(260)
    expect(percents.length).toBe(4)
    expect(percents[0]).toBe(0)
    expect(percents[percents.length - 1]).toBe(
      Math.round(bootCurve(260 / BOOT_DURATION_MS) * 100),
    )
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('exposes progressAt as the pure curve for assertions', () => {
    const { motion } = createHarness()
    expect(motion.progressAt(0.5)).toBe(bootCurve(0.5))
  })
})
