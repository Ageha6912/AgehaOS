import { useEffect, type RefObject } from 'react'

import {
  WAVE_EASE,
  WAVE_ENTER_MS,
  WAVE_EPSILON,
  WAVE_SETTLE_MS,
  cubicBezierAt,
  iconLift,
  iconScale,
  wavePose,
} from '@/core/dock/wave'

interface WaveItem {
  el: HTMLElement
  /** 图标中心 x（视口坐标，pointerenter/resize/scroll 时一次性实测缓存）。 */
  cx: number
  /** 上一帧写入的 scale / lift（变化阈值判据，静止时不产生无效写入）。 */
  lastS: number
  lastLift: number
}

interface WaveState {
  items: WaveItem[]
  pointerX: number
  /** 指针进入后是否有未处理的移动（静态停表判据）。 */
  pointerDirty: boolean
  influence: number
  inflFrom: number
  inflTo: number
  inflStart: number
  inflDur: number
  raf: number
}

function isReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function measure(state: WaveState, container: HTMLElement): void {
  state.items = Array.from(
    container.querySelectorAll<HTMLElement>('[data-wave-icon]'),
  ).map((el) => {
    const cached = state.items.find((item) => item.el === el)
    const rect = el.getBoundingClientRect()
    return {
      el,
      cx: rect.left + rect.width / 2,
      // 保留缓存值：中心 x 不随缩放漂移，重测只更新几何
      lastS: cached?.lastS ?? 1,
      lastLift: cached?.lastLift ?? 0,
    }
  })
}

function setWillChange(state: WaveState, on: boolean): void {
  // SPEC §3.5：只在动效即将发生前挂载，收敛后移除
  for (const item of state.items) item.el.style.willChange = on ? 'transform' : ''
}

function clearPoses(state: WaveState): void {
  for (const item of state.items) {
    item.el.style.transform = ''
    item.el.style.willChange = ''
    item.lastS = 1
    item.lastLift = 0
  }
}

/**
 * 任务栏波浪引擎（motion-lab/dock → 产品归档，docs/DESIGN.md §13）。
 *
 * rAF 纪律：事件回调只记数据（指针坐标），每帧至多一轮「计算 + 写入」；
 * 帧内零布局读取（图标中心在 enter/resize/scroll 一次性实测缓存）。
 * 改进于演示模块：指针悬停静止且包络已满时停表（收敛停帧），pointermove
 * 再唤醒。触屏（pointerType=touch）与 prefers-reduced-motion 下整体不启动，
 * 按钮 CSS 悬停变色/按压反馈保留。只写容器内 [data-wave-icon] 元素的
 * transform，不碰按钮自身——自动隐藏任务栏的 pointerenter/leave 链（坑 42）
 * 不受影响。
 */
export function useDockWave(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // 提升的函数声明拿不到上面的窄化，绑定一个显式非空别名
    const node: HTMLElement = container

    const state: WaveState = {
      items: [],
      pointerX: 0,
      pointerDirty: false,
      influence: 0,
      inflFrom: 0,
      inflTo: 0,
      inflStart: 0,
      inflDur: 0,
      raf: 0,
    }

    function startInfluence(to: number, durMs: number): void {
      state.inflFrom = state.influence
      state.inflTo = to
      state.inflStart = performance.now()
      state.inflDur = durMs
    }

    function ensureLoop(): void {
      if (!state.raf) state.raf = requestAnimationFrame(frame)
    }

    /** 逐帧主循环：只写 transform（translateY + scale），不读任何布局。 */
    function frame(now: number): void {
      state.raf = 0
      state.pointerDirty = false

      // 1) 进入/收敛包络（WAVE_EASE 同款贝塞尔；从当前值续算，可中断可反向）
      if (state.inflDur > 0) {
        const t = Math.min(1, (now - state.inflStart) / state.inflDur)
        state.influence =
          state.inflFrom + (state.inflTo - state.inflFrom) * cubicBezierAt(WAVE_EASE, t)
        if (t >= 1) {
          state.influence = state.inflTo
          state.inflDur = 0
        }
      }

      // 2) 逐图标：波形 scale + 上浮 → 变化阈值内写 transform
      let wrote = false
      for (const item of state.items) {
        let s = 1
        let lift = 0
        if (state.influence > WAVE_EPSILON) {
          s = iconScale(state.pointerX - item.cx, state.influence)
          lift = iconLift(s)
        }
        if (Math.abs(s - item.lastS) > WAVE_EPSILON || Math.abs(lift - item.lastLift) > 0.05) {
          item.el.style.transform = wavePose(s, lift)
          item.lastS = s
          item.lastLift = lift
          wrote = true
        }
      }

      // 3) 完全收起：归位、摘 will-change、停表；悬停静止且无写入 → 停表省帧
      const settled = state.inflDur === 0 && state.influence <= WAVE_EPSILON
      if (settled) {
        clearPoses(state)
        state.influence = 0
        return
      }
      if (state.inflDur === 0 && !state.pointerDirty && !wrote) return
      state.raf = requestAnimationFrame(frame)
    }

    function onPointerEnter(event: PointerEvent): void {
      if (event.pointerType === 'touch') return // 触屏无 hover，保留按钮原生反馈
      if (isReducedMotion()) return
      state.pointerX = event.clientX
      measure(state, node) // 一次性布局实测（非逐帧）
      startInfluence(1, WAVE_ENTER_MS)
      setWillChange(state, true)
      ensureLoop()
    }

    function onPointerMove(event: PointerEvent): void {
      // 只记数据，计算留给 rAF（SPEC §3.3）
      state.pointerX = event.clientX
      state.pointerDirty = true
      if (state.inflDur === 0 && state.influence > WAVE_EPSILON) ensureLoop()
    }

    function onPointerLeave(): void {
      startInfluence(0, WAVE_SETTLE_MS) // 200ms 级收敛回落
      ensureLoop()
    }

    function onRemasure(): void {
      measure(state, node)
    }

    let remeasureRaf = 0
    function scheduleRemeasure(): void {
      if (remeasureRaf) return
      remeasureRaf = requestAnimationFrame(() => {
        remeasureRaf = 0
        onRemasure()
      })
    }

    container.addEventListener('pointerenter', onPointerEnter)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerleave', onPointerLeave)
    container.addEventListener('scroll', scheduleRemeasure, { capture: true })
    window.addEventListener('resize', scheduleRemeasure)

    return () => {
      container.removeEventListener('pointerenter', onPointerEnter)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('scroll', scheduleRemeasure, { capture: true })
      window.removeEventListener('resize', scheduleRemeasure)
      if (remeasureRaf) cancelAnimationFrame(remeasureRaf)
      if (state.raf) cancelAnimationFrame(state.raf)
      clearPoses(state)
    }
  }, [containerRef])
}
