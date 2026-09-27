import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

import type { WindowInstance, WindowState } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import {
  registerClosingGhost,
  unregisterClosingGhost,
} from './closing-ghosts'
import {
  REVERSE_GOAL,
  clearInlinePose,
  prefersReducedMotion,
  startClose,
  startMinimizeFlight,
  startOpen,
  startRestoreFlight,
  supportsWAAPI,
  taskbarAnchor,
  type FlightGoal,
} from './window-motion'

interface ActiveFlight {
  goal: FlightGoal
  anim: Animation
  finish: () => void
}

/**
 * 窗口生命周期动效控制器（docs/DESIGN.md §12）。
 *
 * 状态语义：窗口状态由 store 如实先行提交（taskbar/快捷键/窗口按钮共用），
 * 动效是纯表现层——最小化飞行期间用 inline display 反压 hidden 类保持可见；
 * 关闭则是「store 立即提交 + ghost 快照续播退场」（closing-ghosts.ts），store
 * 里不再有将死窗口。中断语义与 motion-lab 一致：互为反向的请求走
 * anim.reverse() 半途抓回；交叉中断先落定当前目标终态再继续；任何时刻
 * 不锁 store、不锁输入。
 */
export function useWindowMotion(
  win: WindowInstance,
  sectionRef: RefObject<HTMLElement | null>,
  options: { ghost?: boolean } = {},
): { requestClose: () => void } {
  const close = useWindowStore((s) => s.close)
  const flightRef = useRef<ActiveFlight | null>(null)
  const prevStateRef = useRef<WindowState>(win.state)
  // ghost 翻转（store 移除 + 快照接管）不重跑两个 layout effect——飞行与
  // flightRef 都活在同一组件实例上，重跑会在中途 cancel 掉退场动画。
  const ghostRef = useRef(options.ghost ?? false)

  /** 各目标的落定动作：open/restore 清内联位姿；minimize 交还 hidden 类；close 兜底提交 + 注销 ghost。 */
  const finishFor = useCallback(
    (goal: FlightGoal): (() => void) => {
      const el = sectionRef.current
      switch (goal) {
        case 'close':
          return () => {
            close(win.id) // ghost 模式下 store 已提交，这里幂等兜底
            unregisterClosingGhost(win.id)
          }
        case 'open':
        case 'restore':
        case 'minimize':
          return () => {
            if (el) clearInlinePose(el)
          }
      }
    },
    [close, win.id, sectionRef],
  )

  const track = useCallback(
    (goal: FlightGoal, anim: Animation) => {
      flightRef.current = { goal, anim, finish: finishFor(goal) }
      // finished 在自然结束与 reverse() 播完时都 resolve；cancel 时 reject（已被接管/卸载，忽略）
      anim.finished
        .then(() => {
          const active = flightRef.current
          if (!active || active.anim !== anim) return
          flightRef.current = null
          active.finish()
        })
        .catch(() => {})
    },
    [finishFor],
  )

  /** 半途抓回：请求目标与当前飞行互为反向 → reverse 并换绑落定动作。 */
  const reverseTo = useCallback((goal: FlightGoal): boolean => {
    const active = flightRef.current
    if (!active || REVERSE_GOAL[goal] !== active.goal) return false
    active.goal = goal
    active.finish = finishFor(goal)
    active.anim.reverse()
    return true
    // finishFor 仅在 goal 变化时换绑，闭包取当前即可
  }, [finishFor])

  /** 交叉中断：快进落定到当前目标终态（close 目标会提交关闭）。返回被落定的目标。 */
  const settleActive = useCallback((): FlightGoal | null => {
    const active = flightRef.current
    if (!active) return null
    flightRef.current = null
    active.anim.cancel()
    active.finish()
    return active.goal
  }, [])

  const canAnimate = useCallback(
    (el: HTMLElement): boolean => !prefersReducedMotion() && supportsWAAPI(el),
    [],
  )

  // 挂载即播「打开」：从任务栏按钮方向弹性长出（jsdom/降级 → 直接呈现）。
  // ghost 实例（或翻转为 ghost）不重播打开、不在翻转时重跑——flightRef 随实例保留。
  useLayoutEffect(() => {
    if (ghostRef.current) return
    const el = sectionRef.current
    if (!el || !canAnimate(el)) return
    const anim = startOpen(el, taskbarAnchor(win.id))
    if (anim) track('open', anim)
    return () => {
      const active = flightRef.current
      if (active) {
        flightRef.current = null
        active.anim.cancel()
        // 卸载打断飞行时兜底注销 ghost（正常路径由 finished 落定注销）
        unregisterClosingGhost(win.id)
      }
    }
  }, [win.id, canAnimate, sectionRef, track])

  // 最小化/还原 genie：监听状态迁移（任务栏切换、窗口按钮、引擎路径全收口）。
  useLayoutEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const prev = prevStateRef.current
    if (prev === win.state) return
    prevStateRef.current = win.state
    if (ghostRef.current) return
    if (!canAnimate(el)) return // 直接终态：hidden 类/布局已就位

    const wasMinimized = prev === 'minimized'
    const nowMinimized = win.state === 'minimized'
    if (!wasMinimized && nowMinimized) {
      if (reverseTo('minimize')) return // 还原途中半途抓回任务栏
      if (settleActive() === 'close') return // 交叉中断已落定为关闭
      const anim = startMinimizeFlight(el, taskbarAnchor(win.id))
      if (anim) track('minimize', anim)
      return
    }
    if (wasMinimized && !nowMinimized) {
      if (reverseTo('restore')) return // 最小化途中半途抓回桌面
      settleActive()
      const anim = startRestoreFlight(el, taskbarAnchor(win.id))
      if (anim) track('restore', anim)
    }
  }, [win.state, win.id, canAnimate, reverseTo, settleActive, sectionRef, track])

  const requestClose = useCallback(() => {
    // store 立即提交（引擎/任务栏/启动逻辑即刻见到真相），ghost 快照接管退场：
    // 同 key 的组件实例与 DOM 存活到飞完（内容连续），且 aria-hidden 不与
    // 紧随其后的重开/定位抢可达树。
    const el = sectionRef.current
    if (!el || !canAnimate(el)) {
      close(win.id)
      return
    }
    const anim = startClose(el, taskbarAnchor(win.id))
    registerClosingGhost(win)
    close(win.id)
    if (anim) track('close', anim)
    else unregisterClosingGhost(win.id)
  }, [canAnimate, close, settleActive, sectionRef, win])

  return { requestClose }
}
