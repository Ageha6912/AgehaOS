import { useEffect, useRef, type RefObject } from 'react'

import { hasMotionRuntime, prefersReducedMotion } from '@/components/pop-motion'

import {
  classifyVerticalDrag,
  DEFAULT_SWIPE_UP_CONFIG,
  upwardDisplacement,
  type Point,
} from '../gesture/swipe-up-decision'
import {
  DEFAULT_RECENTS_CARD_CONFIG,
  recentsCardTranslation,
  shouldDismissRecentsCard,
  type RecentsCardConfig,
} from './recents-card-decision'

/**
 * 最近任务卡片上滑关闭手势 hook（M3-2，MobileRecentsSheet 卡片）：pointer
 * 事件采集 + rAF 节流的卡片上滑。判定阈值在 recents-card-decision.ts 纯
 * 函数 + swipe-up-decision.ts 轴向纯函数里（可单测），本 hook 只做事件→
 * 样本→DOM 三段：**拖动全程零 React render**——pointermove 只写 ref，
 * 位移换算与卡片 transform 直写收敛在每帧一次的 rAF 回调（动效纪律同
 * DESIGN.md §35.5：只动 transform）。
 *
 * 交互契约：
 * - **激活**：轴向裁决为「向上为主」（死区外 |上滑| > |横向|，复用
 *   classifyVerticalDrag）；横向为主或向下 → reject——横向归卡片轨道的
 *   原生横滚（`.mobile-recents-card` touch-action: pan-x，浏览器接管即
 *   pointercancel，静默复位），向下是误操作。
 * - **确认**：释放时上滑超过 dismissPx（64px）**或**快速上甩（速度 ≥
 *   confirmVelocity，150ms pointermove 事件滑动窗口一次求出——与
 *   use-edge-back/use-swipe-up 同一手法：事件自带真实输入时序，起点参与
 *   速度窗，单跳/合并快甩不失判）→ onDismiss（MobileRecentsSheet 传
 *   mobile-nav-store.closeApp——与卡片删除按钮同一出口，不绕过 store）。
 * - **跟手**：卡片 1:1 上移（translate3d，钳 followMaxPx）；确认后 WAAPI
 *   飞出（120ms fast 档 ease-in，交接 closeApp 卸载）；取消回弹（200ms
 *   base 档 ease-out）。无 WAAPI 运行时（jsdom/老浏览器）→ 瞬时终态。
 * - **动效降级直切**：调用方 followMotion: false（motion-prefs「窗口切换
 *   转场」关档）或 pointerdown 时 prefers-reduced-motion → 全程不写
 *   transform，确认即直切（手势是功能，动画是增强，§35.5）。
 *
 * 冲突防护（手势家族同款）：只响应 touch/pen；激活前不 setPointerCapture、
 * 不 preventDefault（卡片本身是按钮，点击切回的 click 路径必须保留）；
 * 激活后一次性吞掉紧随的 click（上滑误触不切应用）；pointercancel 静默
 * 复位。
 */

/** 确认飞出时长 = --ag-motion-fast（120ms）；取消回弹 = --ag-motion-base
 * （200ms）。DESIGN.md §35.5：动效走既有 tokens，不建新档。 */
const CARD_EXIT_MS = 120
const CARD_CANCEL_MS = 200
/** 释放飞出缓动 = ease-in 档（退场加速离场，与边缘返回确认同语言）。 */
const CARD_EXIT_EASING = 'cubic-bezier(0.55, 0, 1, 0.45)'
/** click 抑制窗口（use-edge-back 同值）：click 在 pointerup 之后派发，
 * 抑制器必须活过这个间隙；没等到 click 就自拆。 */
const CLICK_SUPPRESS_TEARDOWN_MS = 50
/** 速度滑动窗口（ms）：与 use-edge-back 同一口径——释放时由窗口内最老
 * pointermove 事件到当前位置的位移差 ÷ 时差一次求出。 */
const VELOCITY_WINDOW_MS = 150

export interface UseRecentsCardDismissOptions {
  /** 手势宿主元素（卡片按钮）。 */
  targetRef: RefObject<HTMLElement | null>
  /** 确认回调（语义 = closeApp(windowId)，调用方决定）。 */
  onDismiss: () => void
  /** 是否做跟手动画：motion-prefs 关档传 false；reduced-motion 由本 hook
      在 pointerdown 时实时探测。 */
  followMotion: boolean
  /** 判定参数（缺省 = 64px / 0.5px/ms / 跟手上限 120px）。 */
  config?: Partial<RecentsCardConfig>
}

/** 手势进行中的内部状态（全部 ref，绝不进 React state）。 */
interface GestureState {
  pointerId: number
  start: Point
  startTime: number
  latest: Point
  axis: 'undecided' | 'upward' | 'reject'
  follow: boolean
  moves: Array<{ t: number; point: Point }>
  styled: boolean
}

export function useRecentsCardDismiss(options: UseRecentsCardDismissOptions): void {
  const { targetRef } = options
  // 选项经 ref 透读：回调/配置逐帧最新，effect 只挂一次。
  const optionsRef = useRef(options)
  optionsRef.current = options

  const gestureRef = useRef<GestureState | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 飞出/回弹 WAAPI 动画（新一轮 pointerdown 或清理时要撤掉）。 */
  const animRef = useRef<Animation | null>(null)
  const clickSuppressRef = useRef<((event: MouseEvent) => void) | null>(null)

  const clearCardStyles = (): void => {
    const el = targetRef.current
    if (!el) return
    el.style.transform = ''
    el.style.willChange = ''
    el.style.userSelect = ''
  }

  const stopClickSuppression = (): void => {
    const suppress = clickSuppressRef.current
    if (suppress) {
      document.removeEventListener('click', suppress, true)
      clickSuppressRef.current = null
    }
  }

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

  const scheduleClickSuppressionTeardown = (): void => {
    window.setTimeout(stopClickSuppression, CLICK_SUPPRESS_TEARDOWN_MS)
  }

  const cancelScheduledSample = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  const endGesture = (): void => {
    cancelScheduledSample()
    stopClickSuppression()
    if (gestureRef.current?.styled) clearCardStyles()
    gestureRef.current = null
  }

  const cancelSettleAnimation = (): void => {
    const anim = animRef.current
    if (anim) {
      anim.onfinish = null
      anim.cancel()
      animRef.current = null
    }
  }

  const sampleNow = (): void => {
    rafRef.current = null
    const state = gestureRef.current
    const el = targetRef.current
    if (!state || !el) return
    const config = { ...DEFAULT_RECENTS_CARD_CONFIG, ...optionsRef.current.config }

    if (state.axis === 'undecided') {
      // 轴向裁决与整屏上滑同一套语义（死区 10px 由 DEFAULT_SWIPE_UP_CONFIG
      // 提供；classifyVerticalDrag 只消费 axisSlack）。
      state.axis = classifyVerticalDrag(state.start, state.latest, DEFAULT_SWIPE_UP_CONFIG)
      if (state.axis === 'upward') {
        armClickSuppression()
        if (state.follow) {
          el.style.willChange = 'transform'
          el.style.userSelect = 'none'
        }
      }
      if (state.axis !== 'upward') {
        endGesture()
        return
      }
    }

    const upward = upwardDisplacement(state.start, state.latest)
    if (state.follow) {
      const ty = recentsCardTranslation(upward, config)
      el.style.transform = `translate3d(0, ${-ty}px, 0)`
      state.styled = true
    }
  }

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse') return
      if (gestureRef.current !== null) return
      const opts = optionsRef.current
      gestureRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        startTime: performance.now(),
        latest: { x: event.clientX, y: event.clientY },
        axis: 'undecided',
        follow: opts.followMotion && !prefersReducedMotion(),
        moves: [],
        styled: false,
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      state.latest = { x: event.clientX, y: event.clientY }
      state.moves.push({ t: performance.now(), point: state.latest })
      if (state.moves.length > 10) state.moves.shift()
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(sampleNow)
    }

    const finish = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      cancelScheduledSample()
      state.latest = { x: event.clientX, y: event.clientY }
      sampleNow()
      const settled = gestureRef.current
      gestureRef.current = null
      if (!settled || settled.axis !== 'upward') return
      const config = { ...DEFAULT_RECENTS_CARD_CONFIG, ...optionsRef.current.config }
      const upwardPx = upwardDisplacement(settled.start, settled.latest)
      // 速度 = 速度窗口内「最老轨迹点 → 当前位置」的上滑位移差 ÷ 时差
      // （轨迹含 pointerdown 起点——单跳快甩的唯一 move 在终点位置，起点
      // 参与才能还原真实甩速；停顿期位移差为 0 = 取消）。
      const nowMs = performance.now()
      const cutoff = nowMs - VELOCITY_WINDOW_MS
      const oldest: { t: number; point: Point } | null =
        settled.startTime >= cutoff
          ? { t: settled.startTime, point: settled.start }
          : (settled.moves.find((m) => m.t >= cutoff) ?? null)
      const dtMs = oldest !== null ? nowMs - oldest.t : 0
      const velocity =
        oldest !== null && dtMs > 0
          ? (upwardPx - upwardDisplacement(settled.start, oldest.point)) / dtMs
          : ((): number => {
              const elapsedMs = nowMs - settled.startTime
              return elapsedMs > 0 ? upwardPx / elapsedMs : 0
            })()
      const dismissed = shouldDismissRecentsCard({ upwardPx, velocity }, config)
      const onDismiss = optionsRef.current.onDismiss
      scheduleClickSuppressionTeardown()
      if (!settled.follow) {
        if (dismissed) onDismiss()
        return
      }
      const ty = recentsCardTranslation(upwardPx, config)
      if (dismissed) {
        exitUpward(el, ty, onDismiss, animRef, clearCardStyles)
      } else {
        settleBack(el, ty, animRef, clearCardStyles)
      }
    }

    const onPointerCancel = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      endGesture()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', onPointerCancel)
      endGesture()
      cancelSettleAnimation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sampleNow/endGesture 为组件级稳定闭包，选项经 optionsRef 透读
  }, [targetRef])
}

/** 确认飞出：WAAPI 120ms ease-in 上飞淡出 → onDismiss（交接 closeApp 卸
 * 卡；fill: forwards 保持离场位直到卸载）。无 WAAPI 运行时 → 瞬时：样式
 * 还原 + 立即确认（pop-motion 同契约）。 */
function exitUpward(
  el: HTMLElement,
  ty: number,
  onDismiss: () => void,
  animRef: RefObject<Animation | null>,
  clearStyles: () => void,
): void {
  clearStyles()
  if (!hasMotionRuntime()) {
    onDismiss()
    return
  }
  const anim = el.animate(
    [
      { transform: `translate3d(0, ${-ty}px, 0)`, opacity: 1 },
      { transform: 'translate3d(0, -130%, 0)', opacity: 0.4 },
    ],
    { duration: CARD_EXIT_MS, easing: CARD_EXIT_EASING, fill: 'forwards' },
  )
  animRef.current = anim
  anim.onfinish = () => {
    if (animRef.current !== anim) return
    animRef.current = null
    onDismiss()
  }
}

/** 取消回弹：WAAPI 200ms ease-out 回原位 → 同任务先还原内联样式再撤动画
 * （终态 = 恒等变换，零闪烁）。无 WAAPI → 直接还原。 */
function settleBack(
  el: HTMLElement,
  ty: number,
  animRef: RefObject<Animation | null>,
  clearStyles: () => void,
): void {
  if (!hasMotionRuntime()) {
    clearStyles()
    return
  }
  const anim = el.animate(
    [{ transform: `translate3d(0, ${-ty}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
    { duration: CARD_CANCEL_MS, easing: 'ease-out', fill: 'forwards' },
  )
  animRef.current = anim
  anim.onfinish = () => {
    if (animRef.current !== anim) return
    animRef.current = null
    clearStyles()
    anim.cancel()
  }
}
