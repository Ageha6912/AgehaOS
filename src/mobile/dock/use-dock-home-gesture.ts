import { useEffect, useRef, type RefObject } from 'react'

import {
  DEFAULT_DOCK_HOME_GESTURE_CONFIG,
  holdExceedsSlop,
  isHomeSwipeUp,
  type DockHomeGestureConfig,
  type Point,
} from './dock-home-gesture'

/**
 * Dock Home 位手势 hook（M3-2 最近任务入口）：pointer 事件采集的「短按回
 * Home、长按/上滑开最近任务」。判定阈值全部在 dock-home-gesture.ts 纯函数
 * 里（可单测），本 hook 只做事件→定时器/坐标→回调三段：**全程零 React
 * render**（状态全在 ref），也没有跟手动画（按钮不位移）——逐事件只写
 * ref，判定收敛在定时器到点与释放各一次，无需 rAF（纪律说明见
 * dock-home-gesture.ts 模块注释）。
 *
 * 交互契约：
 * - **短按**：pointerdown→pointerup 位移未出死区、按压未满 holdMs → 什么
 *   都不分发，click 照常派发——短按回 Home 仍是按钮原生 onClick
 *   （MobileDock 传 backToHome），本 hook 不拦截不复制；
 * - **长按**：按住 holdMs 内位移未出死区 → 定时器到点分发 onLongPress
 *   （MobileDock 传 openRecents），随后的 pointerup 不再判定（同一按压
 *   只确认一次），紧随的 click 被一次性抑制器吞掉（不抑制会「长按开完
 *   最近任务、抬起又回 Home」双动作）；
 * - **上滑**：按压中位移出死区即取消长按定时器；释放时 isHomeSwipeUp
 *   过阈 → 分发 onSwipeUp（同传 openRecents），click 同样吞掉；
 * - **pointercancel**（系统手势接管）：静默复位，什么都不分发。
 *
 * 冲突防护（与手势家族同款）：
 * - 只响应 touch/pen 指针——鼠标长按是选择/右键语义，不抢（桌面 Shell
 *   根本不挂本 hook）；
 * - 激活前不 setPointerCapture、不 preventDefault——短按的 click 路径
 *   原样保留（提前捕获会吃掉点击，M2-4 同坑）；
 * - 一次性 click 抑制器在「确认后的 pointerup」时刻才挂（click 晚于
 *   pointerup 派发），50ms 没等到 click 自拆——绝不残留吞后续点击（死
 *   按钮禁令）。
 * - Home 位按钮自身带 `[data-no-edge-back]`（MobileDock 侧标记）：M3-1
 *   的 zone 级上滑手势在该起点让位，本手势是 Home 位纵向拖拽的唯一归属。
 */

/** click 抑制窗口（use-edge-back/use-swipe-up 同值）：click 在 pointerup
 * 之后派发，抑制器必须活过这个间隙；没等到 click 就自拆。 */
const CLICK_SUPPRESS_TEARDOWN_MS = 50

export interface UseDockHomeGestureOptions {
  /** 手势宿主元素（MobileDock 传 Home 位按钮）。 */
  targetRef: RefObject<HTMLElement | null>
  /** 长按确认回调（语义 = 打开最近任务）。 */
  onLongPress: () => void
  /** 上滑确认回调（语义 = 打开最近任务）。 */
  onSwipeUp: () => void
  /** 判定参数（缺省 = 500ms / 死区 10px / 上滑 24px）。 */
  config?: Partial<DockHomeGestureConfig>
}

/** 手势进行中的内部状态（全部 ref，绝不进 React state）。 */
interface GestureState {
  pointerId: number
  start: Point
  latest: Point
  /** 长按定时器句柄（出死区 / 释放 / 取消时要撤）。 */
  holdTimer: number | null
  /** 本轮长按是否已确认（确认后释放不再判定、click 必吞）。 */
  longPressFired: boolean
}

export function useDockHomeGesture(options: UseDockHomeGestureOptions): void {
  const { targetRef } = options
  // 选项经 ref 透读：回调/配置逐轮最新，effect 只挂一次（不因每次渲染的
  // 新回调引用重挂监听）。
  const optionsRef = useRef(options)
  optionsRef.current = options

  const gestureRef = useRef<GestureState | null>(null)
  const clickSuppressRef = useRef<((event: MouseEvent) => void) | null>(null)

  const stopClickSuppression = (): void => {
    const suppress = clickSuppressRef.current
    if (suppress) {
      document.removeEventListener('click', suppress, true)
      clickSuppressRef.current = null
    }
  }

  /** 一次性抑制器：吞掉确认后紧随的一枚 click 后自移除（残留会吞掉后续
      一切点击——死按钮禁令）。 */
  const armClickSuppression = (): void => {
    stopClickSuppression()
    const suppress = (event: MouseEvent): void => {
      event.stopPropagation()
      event.preventDefault()
      document.removeEventListener('click', suppress, true)
      clickSuppressRef.current = null
    }
    document.addEventListener('click', suppress, true)
    clickSuppressRef.current = suppress
  }

  const clearHoldTimer = (): void => {
    const state = gestureRef.current
    if (state?.holdTimer !== null && state?.holdTimer !== undefined) {
      window.clearTimeout(state.holdTimer)
      state.holdTimer = null
    }
  }

  const endGesture = (): void => {
    clearHoldTimer()
    gestureRef.current = null
  }

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    const onPointerDown = (event: PointerEvent): void => {
      // 鼠标长按是选择/右键语义；第二轮指针不接管进行中的手势。
      if (event.pointerType === 'mouse') return
      if (gestureRef.current !== null) return
      gestureRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        latest: { x: event.clientX, y: event.clientY },
        holdTimer: null,
        longPressFired: false,
      }
      const config = { ...DEFAULT_DOCK_HOME_GESTURE_CONFIG, ...optionsRef.current.config }
      gestureRef.current.holdTimer = window.setTimeout(() => {
        const state = gestureRef.current
        if (state === null || state.longPressFired) return
        state.longPressFired = true
        state.holdTimer = null
        optionsRef.current.onLongPress()
        // click 抑制器此刻不挂：用户可能继续按住很久，50ms 窗口活不到
        // pointerup 之后的 click——抑制推迟到释放时刻（见 onPointerUp）。
      }, config.holdMs)
    }

    const onPointerMove = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      state.latest = { x: event.clientX, y: event.clientY }
      const config = { ...DEFAULT_DOCK_HOME_GESTURE_CONFIG, ...optionsRef.current.config }
      // 出死区：用户在拖拽不是在长按——撤定时器（不 endGesture，释放时
      // 还要判上滑）。
      if (!state.longPressFired && state.holdTimer !== null && holdExceedsSlop(state.start, state.latest, config)) {
        window.clearTimeout(state.holdTimer)
        state.holdTimer = null
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      state.latest = { x: event.clientX, y: event.clientY }
      const config = { ...DEFAULT_DOCK_HOME_GESTURE_CONFIG, ...optionsRef.current.config }
      const fired = state.longPressFired
      const swipe = !fired && isHomeSwipeUp(state.start, state.latest, config)
      endGesture()
      if (!fired && !swipe) return
      // 确认后的释放：click 就在紧后——此刻挂一次性抑制器才活得到它。
      armClickSuppression()
      window.setTimeout(stopClickSuppression, CLICK_SUPPRESS_TEARDOWN_MS)
      if (swipe) optionsRef.current.onSwipeUp()
      // 长按路径的回调已在定时器里分发过，这里只补 click 抑制。
    }

    const onPointerCancel = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      // 系统手势接管：静默复位（长按未分发、click 抑制器未挂）。
      endGesture()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      endGesture()
      stopClickSuppression()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- endGesture 为组件级稳定闭包，选项经 optionsRef 透读
  }, [targetRef])
}
