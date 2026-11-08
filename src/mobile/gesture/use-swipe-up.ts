import { useEffect, useRef, type RefObject } from 'react'

import { hasMotionRuntime, prefersReducedMotion } from '@/components/pop-motion'

import {
  classifyVerticalDrag,
  DEFAULT_SWIPE_UP_CONFIG,
  isBottomOrigin,
  shouldConfirmSwipeUp,
  swipeUpTranslation,
  upwardDisplacement,
  type Point,
  type SwipeUpConfig,
  type ViewportAxis,
} from './swipe-up-decision'

/**
 * 上滑唤起启动器手势 hook（M3-1，概念展板屏③的手势入口）：pointer 事件
 * 采集 + rAF 节流的底缘上滑。判定阈值全部在 swipe-up-decision.ts 纯函数里
 * （可单测），本 hook 只做事件→样本→DOM 三段：**拖动全程零 React render**
 * ——pointermove 只把最新坐标写进 ref，位移换算与宿主 transform 直写都收敛
 * 在每帧一次的 rAF 回调里（动效纪律同 DESIGN.md §35.5：只动 transform，
 * 走既有 motion tokens）。
 *
 * 挂载点唯一 = MobileShell 的 `mobile-dock-zone`（Dock 本体 + safe-area
 * 预留带的包裹层）——**刻意不挂全局**：内容区（`.mobile-content-scroll`）
 * 的纵向原生滚动与此手势同为垂直方向，全局挂载只能在事件层用死区/速度
 * 去猜「这次是滚动还是唤起」，边界情形永远打架；Dock 底缘与内容区在空间
 * 上隔离（Dock 与预留带均不可滚动），起于底缘带的上滑不存在「本来想滚动」
 * 的解读，冲突在挂载点上消解而不是在判定里调和（元素级隔离之外，几何带
 * isBottomOrigin 是第二道门，两层都过才激活）。
 *
 * 交互契约：
 * - **激活**：起点在底缘带内（默认 ≤72px，覆盖 Dock + 预留带）+ touch/pen
 *   指针 + 轴向裁决为「向上为主」（死区外 |上滑| > |横向|）。横向为主或
 *   向下 → `reject`；死区内 → `undecided`（点击 Dock 位照常触发 click，
 *   不拦截）。
 * - **确认**：释放时上滑距离 > 视口高 × confirmRatio（0.15）**或**快速上甩
 *   （速度 ≥ confirmVelocity，150ms pointermove 事件滑动窗口求出——与
 *   use-edge-back 同一手法：事件自带真实输入时序，起点参与速度窗，单跳/
 *   合并快甩不失判；rAF 采样落点求不了甩速）→ `onConfirm`（MobileShell
 *   传 mobile-launcher-store 的 openLauncher，与网格搜索按钮同一 store 出
 *   口，Launcher 打开期间本 hook enabled=false 不重复触发）。
 * - **跟手**：宿主（Dock 区）1:1 上抬（translate3d，钳 followMaxPx）——
 *   启动器抽屉自 Dock 位升出（Bottom Sheet 锚底），Dock 随手上抬是「抽屉
 *   将至」的物理暗示。确认与取消都回弹（200ms base 档 ease-out）：确认时
 *   Launcher 自带 sheet-in 动画从同一位置接管视觉，Dock 同时归位；无 WAAPI
 *   运行时（jsdom/老浏览器）→ 瞬时终态（pop-motion 同一降级契约）。
 * - **动效降级直切**：调用方 `followMotion: false`（motion-prefs「窗口切
 *   换转场」关档）或指针落下时 prefers-reduced-motion 生效 → 全程不写
 *   transform，确认直开（判定/确认逻辑不变，只去动画——手势是功能，动画
 *   是增强，DESIGN.md §35.5）。
 *
 * 冲突防护：
 * - 只响应 touch/pen 指针（桌面 Shell 根本不挂本 hook；鼠标拖拽留给文本
 *   选择）；
 * - 激活前不 setPointerCapture、不 preventDefault——Dock 位 44×44 命中区
 *   与激活带重叠，提前捕获会把点击吃掉；pointercancel 静默复位；
 * - 起点落在 `[data-no-edge-back]` 标记元素内 → 不激活（与边缘返回同一
 *   逃生口语义：该面的指针交互归该面，手势家族统一尊重）；
 * - 激活后一次性吞掉紧随的 click（上滑误落在起点 Dock 位上时不触发点击）。
 */

/** 取消/确认回弹时长 = --ag-motion-base（200ms）。DESIGN.md §35.5：动效走
 * 既有 tokens，不建新档——与 Launcher sheet-in 同长，视觉同拍交接。 */
const SWIPE_UP_SETTLE_MS = 200
/** click 抑制窗口（use-edge-back 同值）：click 在 pointerup 之后派发，
 * 抑制器必须活过这个间隙；没等到 click 就自拆，绝不残留吞后续点击。 */
const CLICK_SUPPRESS_TEARDOWN_MS = 50
/** 速度滑动窗口（ms）：与 use-edge-back 同一口径——释放时由窗口内最老
 * pointermove 事件到当前位置的位移差 ÷ 时差一次求出。窗口 ~9 帧；停顿
 * 期间位移差为 0（按住不动释放 = 取消）。 */
const VELOCITY_WINDOW_MS = 150

export interface UseSwipeUpOptions {
  /** 手势宿主元素（pointer 事件挂这里，跟手 transform 也写这里——
      MobileShell 传 Dock 区包裹层）。 */
  targetRef: RefObject<HTMLElement | null>
  /** 总开关（home 视图且 Launcher 关闭时 true）；false 时不挂监听、不留
      任何副作用（Launcher 打开期间手势不重复触发、应用视图不响应）。 */
  enabled: boolean
  /** 确认回调（语义 = 打开 Launcher，调用方决定）。 */
  onConfirm: () => void
  /** 是否做跟手动画：motion-prefs 关档传 false；reduced-motion 由本 hook
      在 pointerdown 时实时探测（prefersReducedMotion()），二者任一生效 →
      跟手与回弹全免，确认直开。 */
  followMotion: boolean
  /** 判定参数（缺省 = 底缘 72px / 0.15 视口高 / 0.5px/ms / 死区 10px /
      跟手上限 80px）。 */
  config?: Partial<SwipeUpConfig>
  /** 视口取样（单测注入固定尺寸；缺省 = window.innerWidth/innerHeight——
      判定消费 client 坐标，视口是窗口而非 Dock 区窄条的 boundingRect）。 */
  getViewport?: () => ViewportAxis
}

/** 手势进行中的内部状态（全部 ref，绝不进 React state）。 */
interface GestureState {
  pointerId: number
  start: Point
  /** 落下时刻（performance.now，ms）——全程无 move 时算平均速度兜底。 */
  startTime: number
  /** 最新事件坐标（pointermove 每事件写一次，rAF 只读它）。 */
  latest: Point
  /** 轴向裁决结果（undecided 期间不写任何 DOM）。 */
  axis: 'undecided' | 'upward' | 'reject'
  /** 本轮是否允许跟手动画（followMotion && !reduced-motion，落下时定死）。 */
  follow: boolean
  /** pointermove 事件轨迹（时间升序，速度窗口的数据源；定长截尾）。 */
  moves: Array<{ t: number; point: Point }>
  /** 已写入宿主样式（结束时要还原）。 */
  styled: boolean
}

export function useSwipeUp(options: UseSwipeUpOptions): void {
  const { targetRef, enabled } = options
  // 选项经 ref 透读：回调/配置逐帧最新，effect 只依赖 enabled（不因每次
  // 渲染的新 onConfirm 引用重挂监听）。
  const optionsRef = useRef(options)
  optionsRef.current = options

  const gestureRef = useRef<GestureState | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 回弹 WAAPI 动画（新一轮 pointerdown 或清理时要撤掉）。 */
  const animRef = useRef<Animation | null>(null)
  /** 激活后挂的一次性 click 抑制器（document 捕获段）。 */
  const clickSuppressRef = useRef<((event: MouseEvent) => void) | null>(null)
  /** 到期自拆计时器句柄（F2 审查：快速 re-arm 时旧定时器不得拆掉新一轮抑制器）。 */
  const suppressTeardownRef = useRef<number | null>(null)

  const clearHostStyles = (): void => {
    const el = targetRef.current
    if (!el) return
    el.style.transform = ''
    el.style.willChange = ''
    el.style.userSelect = ''
  }

  const stopClickSuppression = (): void => {
    if (suppressTeardownRef.current !== null) {
      window.clearTimeout(suppressTeardownRef.current)
      suppressTeardownRef.current = null
    }
    const suppress = clickSuppressRef.current
    if (suppress) {
      document.removeEventListener('click', suppress, true)
      clickSuppressRef.current = null
    }
  }

  /** 一次性抑制器：吞掉上滑误触发的一枚 click 后自移除（残留会吞掉后续
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

  /** 抑制器只覆盖「释放后紧随的那枚 click」窗口；没等到 click（手指移出
      起点元素等，浏览器不派发）也要到期自拆。 */
  const scheduleClickSuppressionTeardown = (): void => {
    if (suppressTeardownRef.current !== null) window.clearTimeout(suppressTeardownRef.current)
    suppressTeardownRef.current = window.setTimeout(() => {
      suppressTeardownRef.current = null
      stopClickSuppression()
    }, CLICK_SUPPRESS_TEARDOWN_MS)
  }

  const cancelScheduledSample = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  /** 结束手势：样式还原 + 抑制器拆除（回弹动画由 finish 决定是否播）。 */
  const endGesture = (): void => {
    cancelScheduledSample()
    stopClickSuppression()
    if (gestureRef.current?.styled) clearHostStyles()
    gestureRef.current = null
  }

  /** 终止进行中的 WAAPI 动画（新一轮手势 / effect 清理）。 */
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
    const config = { ...DEFAULT_SWIPE_UP_CONFIG, ...optionsRef.current.config }

    if (state.axis === 'undecided') {
      state.axis = classifyVerticalDrag(state.start, state.latest, config)
      if (state.axis === 'upward') {
        // 轴向落定：此刻才进入「跟手」——锁文本选择 + 吞掉紧随的 click。
        armClickSuppression()
        if (state.follow) {
          el.style.willChange = 'transform'
          el.style.userSelect = 'none'
        }
      }
      if (state.axis !== 'upward') {
        // 横向为主/向下：本轮作废（不写任何样式，click 不吞）。
        endGesture()
        return
      }
    }

    const upward = upwardDisplacement(state.start, state.latest)
    // rAF 只管视觉：速度判定在释放时由事件轨迹一次求出（见 finish）。

    if (state.follow) {
      const ty = swipeUpTranslation(upward, config)
      el.style.transform = `translate3d(0, ${-ty}px, 0)`
      state.styled = true
    }
  }

  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    const onPointerDown = (event: PointerEvent): void => {
      // 鼠标拖拽留给文本选择；第二轮指针不接管进行中的手势。
      if (event.pointerType === 'mouse') return
      if (gestureRef.current !== null) return
      const opts = optionsRef.current
      const config = { ...DEFAULT_SWIPE_UP_CONFIG, ...opts.config }
      const start: Point = { x: event.clientX, y: event.clientY }
      const viewport = resolveViewport(el, opts.getViewport)
      if (!isBottomOrigin(start, viewport, config)) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-no-edge-back]') !== null) return

      cancelSettleAnimation()
      gestureRef.current = {
        pointerId: event.pointerId,
        start,
        startTime: performance.now(),
        latest: start,
        axis: 'undecided',
        // reduced-motion 在落下时实时探测（系统档中途开启也能即刻生效）。
        follow: opts.followMotion && !prefersReducedMotion(),
        moves: [],
        styled: false,
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      state.latest = { x: event.clientX, y: event.clientY }
      // 事件轨迹（速度数据源）：O(1) 追加 + 定长截尾，无渲染无布局。
      state.moves.push({ t: performance.now(), point: state.latest })
      if (state.moves.length > 10) state.moves.shift()
      // rAF 节流：事件只写坐标，位移换算 + transform 每帧一次（零 render）。
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(sampleNow)
    }

    const finish = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      // 释放样本：rAF 可能还压着最后一拍（快速甩动常在帧间隙抬起）——
      // 先把它并进来再判，避免最终位移被半帧延迟抹掉。
      cancelScheduledSample()
      state.latest = { x: event.clientX, y: event.clientY }
      sampleNow()
      const settled = gestureRef.current
      gestureRef.current = null
      if (!settled || settled.axis !== 'upward') {
        // 未激活（undecided 点击 / reject）——无样式要还原，抑制器未挂。
        return
      }
      const config = { ...DEFAULT_SWIPE_UP_CONFIG, ...optionsRef.current.config }
      const viewport = resolveViewport(el, optionsRef.current.getViewport)
      const upwardPx = upwardDisplacement(settled.start, settled.latest)
      // 速度 = 速度窗口内「最老轨迹点 → 当前位置」的上滑位移差 ÷ 时差。
      // 轨迹点含 pointerdown 起点（若在窗内，它天然是最老点）与全部 move
      // 事件——单跳/合并快甩的唯一 move 就在终点位置，起点参与才能还原
      // 真实甩速；停顿期位移差为 0（按住不动释放 = 取消）；轨迹全部老化
      // 出窗或 dt=0 → 用落下起的平均速度兜底，快甩不失判。
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
      const confirmed = shouldConfirmSwipeUp({ upwardPx, velocity, viewport }, config)
      const onConfirm = optionsRef.current.onConfirm
      // click 抑制器活到释放后的 click 窗口结束（触发一次自移除 + 到期
      // 兜底拆除），不能在 pointerup 就拆——browser 的 click 晚于 pointerup。
      scheduleClickSuppressionTeardown()
      if (!settled.follow) {
        // 动效降级：确认直开，取消无事发生。
        if (confirmed) onConfirm()
        return
      }
      // 确认与取消都回弹归位（200ms ease-out）：确认时 Launcher 的
      // sheet-in 自同一位置升出接管视觉，Dock 同拍落回；取消则单纯归位。
      settleBack(el, swipeUpTranslation(upwardPx, config), animRef, clearHostStyles)
      if (confirmed) onConfirm()
    }

    const onPointerCancel = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      // 系统手势接管：静默复位（无动画——宿主交还给浏览器处置）。
      endGesture()
    }

    el.addEventListener('pointerdown', onPointerDown)
    // move/up/cancel 挂在 window：pen/鼠标拖出宿主（Dock 区仅 ~90px 高）后
    // 仍能收到序列，否则 pointerup 落在兄弟节点、手势永久悬挂拒后续输入。
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', onPointerCancel)
      endGesture()
      cancelSettleAnimation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sampleNow/endGesture 为组件级稳定闭包，选项经 optionsRef 透读
  }, [targetRef, enabled])
}

/** 视口取样：单测可注入；缺省 = window 尺寸。判定函数全部消费 client 坐标
 * （event.clientX/Y），视口必须是窗口本身——宿主是 Dock 区窄条（~77px 高），
 * 不能像 use-edge-back（全屏面板 rect = 视口）那样拿 boundingRect 当视口，
 * 否则底缘带判定与 0.15 视口高的距离档全部失真。 */
function resolveViewport(_el: HTMLElement, getViewport?: () => ViewportAxis): ViewportAxis {
  if (getViewport) return getViewport()
  return { width: window.innerWidth, height: window.innerHeight }
}

/** 回弹归位：WAAPI 200ms ease-out 回原位 → 同任务先还原内联样式再撤动画
 * （终态 = 恒等变换，零闪烁）。无 WAAPI → 直接还原。与 use-edge-back 的
 * settleBack 同构（那边确认滑出/取消回弹分两路，这里确认/取消同归位）。 */
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
    { duration: SWIPE_UP_SETTLE_MS, easing: 'ease-out', fill: 'forwards' },
  )
  animRef.current = anim
  anim.onfinish = () => {
    if (animRef.current !== anim) return
    animRef.current = null
    clearStyles()
    anim.cancel()
  }
}
