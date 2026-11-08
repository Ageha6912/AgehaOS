import { useEffect, useRef, type RefObject } from 'react'

import { hasMotionRuntime, prefersReducedMotion } from '@/components/pop-motion'

import {
  classifyDrag,
  DEFAULT_EDGE_BACK_CONFIG,
  edgeBackTranslation,
  inwardDisplacement,
  isEdgeOrigin,
  shouldConfirmEdgeBack,
  type EdgeBackConfig,
  type Point,
  type ViewportAxis,
} from './edge-back-decision'

/**
 * 边缘返回手势 hook（M2-4，HANDOFF §4.0-4）：pointer 事件采集 + rAF 节流的
 * 左缘滑入返回。判定阈值全部在 edge-back-decision.ts 纯函数里（可单测），
 * 本 hook 只做事件→样本→DOM 三段：**拖动全程零 React render**——pointermove
 * 只把最新坐标写进 ref（每事件一次赋值），位移换算与面板 transform 直写
 * 都收敛在每帧一次的 rAF 回调里（触摸目标 ≥44px 之外的动效纪律见
 * DESIGN.md §35.5：只动 transform，走既有 motion tokens）。
 *
 * 交互契约：
 * - **激活**：起点在左缘激活带内（默认 ≤24px）+ 轴向裁决为「向内为主」
 *   （死区外 |向内| > |横向|）。纵向为主的拖拽 = `reject`——把交互还给
 *   `.mobile-app-body` 的原生纵向滚动（浏览器接管滚动即 pointercancel，
 *   这里同样静默复位）。
 * - **确认**：释放时过半（> 视口宽 × confirmRatio）**或**快速甩动
 *   （速度 ≥ confirmVelocity）→ `onConfirm`（MobileAppHost 传 backToHome，
 *   与返回键/popstate 同一出口，不绕过 nav store）。速度用 **pointermove
 *   事件时序的滑动窗口**（见 VELOCITY_WINDOW_MS）在释放时一次求出：窗口内
 *   最老事件 → 当前位置的位移差 ÷ 时差——事件自带真实输入时序，不依赖
 *   rAF 采样落点（采样帧落在末次 move 之后会让「采样窗口速度」归零）；
 *   停顿时当前位置 = 窗口内末次 move 位置，位移差自然为 0（按住不动释放
 *   = 取消）；全程无 move（down→up 一帧内完成）用落下起的平均速度兜底。
 * - **跟手**：面板 1:1 位移（translate3d，钳一个屏宽），确认后 WAAPI 滑出
 *   （120ms fast 档 ease-in）再交接既有退场帧；取消则回弹（200ms base 档
 *   ease-out）。无 WAAPI 运行时（jsdom/老浏览器）→ 瞬时终态（与 pop-motion
 *   同一降级契约）。
 * - **动效降级直切**：调用方 `followMotion: false`（motion-prefs「窗口切换
 *   转场」关档）或指针落下时 prefers-reduced-motion 生效 → 全程不写面板
 *   transform，确认即直切（判定/确认逻辑不变，只去动画——手势是功能，
 *   动画是增强，reduced 语义见 DESIGN.md §35.5）。
 *
 * 冲突防护：
 * - 只响应 touch/pen 指针（鼠标横向拖拽留给文本选择，桌面 Shell 根本不挂
 *   本 hook）；
 * - 轴向死区 + pointercancel 保住缘带内的纵向滚动与点击（激活前不
 *   setPointerCapture、不 preventDefault——header 返回键 44×44 命中区与
 *   左缘激活带重叠，提前捕获会把点击吃掉）；
 * - 起点落在 `[data-no-edge-back]` 标记元素内 → 不激活（横向滚动面的
 *   预留逃生口，机制随本 hook 单测钉住；2026-10-09 审计 Files/Notes/
 *   Settings 无横向滚动面，暂无消费方——见 MobileAppHost 模块注释）；
 *   Type B/羽化应用是 sandbox iframe，指针事件天然不达宿主文档；
 * - 激活后一次性吞掉紧随的 click（拖拽误落在起点元素上时不触发点击）。
 *
 * 参数化（side/edgeWidth/confirmRatio/confirmVelocity/axisSlack + 视口
 * 取样器）：后续 edge gestures（右缘/顶缘）换一份 config 即可复用本 hook。
 */

/** 确认滑出时长 = --ag-motion-fast（120ms）；取消回弹 = --ag-motion-base
 * （200ms）。DESIGN.md §35.5：动效走既有 tokens，不建新档。 */
const EDGE_BACK_EXIT_MS = 120
const EDGE_BACK_CANCEL_MS = 200
/** 释放滑出缓动 = ease-in 档（退场加速离场，与弹层退场同语言）。 */
const EDGE_BACK_EXIT_EASING = 'cubic-bezier(0.55, 0, 1, 0.45)'
/** click 抑制窗口：click 在 pointerup 之后派发（同任务/下一任务），抑制器
 * 必须活过这个间隙；该窗口内没等到 click 就自拆，绝不残留吞后续点击。 */
const CLICK_SUPPRESS_TEARDOWN_MS = 50
/** 速度滑动窗口（ms）：甩动速度在释放时由窗口内最老 pointermove 事件到
 * 当前位置的位移差 ÷ 时差一次求出。窗口 ~9 帧——偏宽（宁多识别甩动，
 * 慢拖由距离判据把关）；停顿期间位移差为 0（当前位置即末次 move 位置），
 * 按住不动释放自然归零。 */
const VELOCITY_WINDOW_MS = 150

export interface UseEdgeBackOptions {
  /** 手势宿主元素（pointer 事件挂这里，transform 也写这里）。 */
  targetRef: RefObject<HTMLElement | null>
  /** 总开关（view='app' 时 true）；false 时不挂监听、不留任何副作用。 */
  enabled: boolean
  /** 确认回调（语义 = backToHome，调用方决定）。 */
  onConfirm: () => void
  /** 是否做跟手动画：motion-prefs 关档传 false；reduced-motion 由本 hook
   * 在 pointerdown 时实时探测（prefersReducedMotion()），二者任一生效 →
   * 跟手动画与滑出/回弹全免，确认直切。 */
  followMotion: boolean
  /** 判定参数（缺省 = 左缘 24px / 过半 / 0.5px/ms / 死区 10px）。 */
  config?: Partial<EdgeBackConfig>
  /** 视口取样（单测注入固定尺寸；缺省 = 宿主元素 boundingRect，回退
   * window.innerWidth/innerHeight）。 */
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
  axis: 'undecided' | 'inward' | 'reject'
  /** 本轮是否允许跟手动画（followMotion && !reduced-motion，落下时定死）。 */
  follow: boolean
  /** 视口（落下时定死，F2 审查：rAF 每帧 getBoundingClientRect 与面板
   *  transform 写操作互逼同步刷新——读-写抖动）。 */
  viewport: ViewportAxis
  /** pointermove 事件轨迹（时间升序，速度窗口的数据源；定长截尾）。 */
  moves: Array<{ t: number; point: Point }>
  /** 已写入面板样式（结束时要还原）。 */
  styled: boolean
}

export function useEdgeBack(options: UseEdgeBackOptions): void {
  const { targetRef, enabled } = options
  // 选项经 ref 透读：回调/配置逐帧最新，effect 只依赖 enabled（不因每次
  // 渲染的新 onConfirm 引用重挂监听）。
  const optionsRef = useRef(options)
  optionsRef.current = options

  const gestureRef = useRef<GestureState | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 退出/回弹 WAAPI 动画（新一轮 pointerdown 或清理时要撤掉）。 */
  const animRef = useRef<Animation | null>(null)
  /** 滑出动画挂起中的「确认回 home」：动画被新一轮手势取消时不能丢。 */
  const pendingConfirmRef = useRef<(() => void) | null>(null)
  /** 激活后挂的一次性 click 抑制器（document 捕获段）。 */
  const clickSuppressRef = useRef<((event: MouseEvent) => void) | null>(null)
  /** 到期自拆计时器句柄（F2 审查：快速 re-arm 时旧定时器不得拆掉新一轮抑制器）。 */
  const suppressTeardownRef = useRef<number | null>(null)

  const clearPanelStyles = (): void => {
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

  const armClickSuppression = (): void => {
    stopClickSuppression()
    // 一次性抑制器：吞掉拖拽误触发的一枚 click 后自移除（残留会吞掉后续
    // 一切点击——死按钮禁令，DESIGN.md §0.5 同源纪律）。
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
   * 起点元素等，浏览器不派发）也要到期自拆，防止吞掉用户下一次点击。 */
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

  /** 结束手势：样式还原 + 抑制器拆除（动画由调用方决定是否播）。 */
  const endGesture = (): void => {
    cancelScheduledSample()
    stopClickSuppression()
    // 无条件还原：styled 记账只用于优化，漏还原会让面板永久偏移。
    clearPanelStyles()
    gestureRef.current = null
  }

  /** 终止进行中的 WAAPI 动画（新一轮手势 / effect 清理）。
   *  `flush=true`：已确认的回 home 不能因动画被取消而丢失（新按压取消滑出）。 */
  const cancelExitAnimation = (flush = false): void => {
    const anim = animRef.current
    const pending = pendingConfirmRef.current
    pendingConfirmRef.current = null
    if (anim) {
      anim.onfinish = null
      anim.cancel()
      animRef.current = null
    }
    if (flush) pending?.()
  }

  const sampleNow = (): void => {
    rafRef.current = null
    const state = gestureRef.current
    const el = targetRef.current
    if (!state || !el) return
    const config = { ...DEFAULT_EDGE_BACK_CONFIG, ...optionsRef.current.config }
    const viewport = state.viewport

    if (state.axis === 'undecided') {
      state.axis = classifyDrag(state.start, state.latest, config)
      if (state.axis === 'inward') {
        // 轴向落定：此刻才进入「跟手」——锁文本选择 + 吞掉紧随的 click。
        armClickSuppression()
        if (state.follow) {
          el.style.willChange = 'transform'
          el.style.userSelect = 'none'
        }
      }
      if (state.axis !== 'inward') {
        // 纵向/向外：交还原生滚动与点击，本轮作废（不写任何样式）。
        endGesture()
        return
      }
    }

    const inward = inwardDisplacement(state.start, state.latest, config)
    // rAF 只管视觉：速度判定在释放时由事件轨迹一次求出（见 finish）。

    if (state.follow) {
      const tx = edgeBackTranslation(inward, viewport, config)
      el.style.transform = `translate3d(${tx}px, 0, 0)`
      state.styled = true
    }
  }

  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    const onPointerDown = (event: PointerEvent): void => {
      // 鼠标横向拖拽留给文本选择；第二轮指针不接管进行中的手势。
      if (event.pointerType === 'mouse') return
      if (gestureRef.current !== null) return
      const opts = optionsRef.current
      const config = { ...DEFAULT_EDGE_BACK_CONFIG, ...opts.config }
      const start: Point = { x: event.clientX, y: event.clientY }
      const viewport = resolveViewport(el, opts.getViewport)
      if (!isEdgeOrigin(start, viewport, config)) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-no-edge-back]') !== null) return

      cancelExitAnimation(true)
      clearPanelStyles()
      gestureRef.current = {
        pointerId: event.pointerId,
        start,
        startTime: performance.now(),
        latest: start,
        axis: 'undecided',
        // reduced-motion 在落下时实时探测（系统档中途开启也能即刻生效）。
        follow: opts.followMotion && !prefersReducedMotion(),
        // viewport 落下时定死（旋转/resize 期间的新手势会重新落下取新值）。
        viewport: resolveViewport(el, opts.getViewport),
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
      if (!settled || settled.axis !== 'inward') {
        // 未激活（undecided 点击 / reject）——无样式要还原，抑制器未挂。
        return
      }
      const config = { ...DEFAULT_EDGE_BACK_CONFIG, ...optionsRef.current.config }
      const viewport = settled.viewport
      const inward = inwardDisplacement(settled.start, settled.latest, config)
      // 速度 = 速度窗口内「最老轨迹点 → 当前位置」的位移差 ÷ 时差。轨迹点
      // 含 pointerdown 起点（若在窗内，它天然是最老点）与全部 move 事件——
      // 单跳/合并快甩的唯一 move 就在终点位置，只看 move 事件位移差恒 0，
      // 起点参与才能还原 5→145 的真实甩速。停顿期位移差为 0（当前位置即
      // 末次 move 位置，按住释放 = 取消）；轨迹全部老化出窗（长拖后按住）
      // 或 dt=0 → 用落下起的平均速度兜底，快甩不失判。
      const nowMs = performance.now()
      const cutoff = nowMs - VELOCITY_WINDOW_MS
      const oldest: { t: number; point: Point } | null =
        settled.startTime >= cutoff
          ? { t: settled.startTime, point: settled.start }
          : (settled.moves.find((m) => m.t >= cutoff) ?? null)
      const dtMs = oldest !== null ? nowMs - oldest.t : 0
      const velocity =
        oldest !== null && dtMs > 0
          ? (inward - inwardDisplacement(settled.start, oldest.point, config)) / dtMs
          : ((): number => {
              const elapsedMs = nowMs - settled.startTime
              return elapsedMs > 0 ? inward / elapsedMs : 0
            })()
      const confirmed = shouldConfirmEdgeBack(
        { inwardDx: inward, velocity, viewport },
        config,
      )
      const onConfirm = optionsRef.current.onConfirm
      // click 抑制器活到释放后的 click 窗口结束（触发一次自移除 + 到期
      // 兜底拆除），不能在 pointerup 就拆——browser 的 click 晚于 pointerup。
      scheduleClickSuppressionTeardown()
      if (!settled.follow) {
        // 动效降级：确认直切，取消无事发生。
        if (confirmed) onConfirm()
        return
      }
      const tx = edgeBackTranslation(inward, viewport, config)
      if (confirmed) {
        exitWithSlide(el, tx, onConfirm, animRef, clearPanelStyles, pendingConfirmRef)
      } else {
        settleBack(el, tx, animRef, clearPanelStyles)
      }
    }

    const onPointerCancel = (event: PointerEvent): void => {
      const state = gestureRef.current
      if (state === null || event.pointerId !== state.pointerId) return
      // 原生滚动/系统手势接管：静默复位（无动画——面板交还给浏览器处置）。
      endGesture()
    }

    el.addEventListener('pointerdown', onPointerDown)
    // move/up/cancel 挂 window：笔/鼠标拖出面板（或 pointerup 落在子节点外）
    // 时仍能完成/取消手势，避免 gestureRef 永久悬挂。
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', onPointerCancel)
      endGesture()
      cancelExitAnimation()
      clearPanelStyles()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sampleNow/endGesture 为组件级稳定闭包，选项经 optionsRef 透读
  }, [targetRef, enabled])
}

/** 视口取样：单测可注入；缺省 = 宿主 boundingRect（移动宿主 = 全屏面板，
 * rect 即视口），取不到（display:none 等）回退 window 尺寸。 */
function resolveViewport(el: HTMLElement, getViewport?: () => ViewportAxis): ViewportAxis {
  if (getViewport) return getViewport()
  const rect = el.getBoundingClientRect()
  const width = rect.width || window.innerWidth
  const height = rect.height || window.innerHeight
  return { width, height }
}

/** 确认滑出：WAAPI 120ms ease-in 滑出屏 → 样式还原 → onConfirm（交接既有
 * 200ms 退场帧；fill: forwards 保持离屏位直到卸载）。无 WAAPI 运行时
 * （jsdom/老浏览器）→ 瞬时：样式还原 + 立即确认（pop-motion 同契约）。 */
function exitWithSlide(
  el: HTMLElement,
  tx: number,
  onConfirm: () => void,
  animRef: RefObject<Animation | null>,
  clearStyles: () => void,
  pendingRef: RefObject<(() => void) | null>,
): void {
  clearStyles()
  if (!hasMotionRuntime()) {
    onConfirm()
    return
  }
  const anim = el.animate(
    [{ transform: `translate3d(${tx}px, 0, 0)` }, { transform: 'translate3d(-100%, 0, 0)' }],
    { duration: EDGE_BACK_EXIT_MS, easing: EDGE_BACK_EXIT_EASING, fill: 'forwards' },
  )
  animRef.current = anim
  pendingRef.current = onConfirm
  anim.onfinish = () => {
    if (animRef.current !== anim) return
    animRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.()
  }
}

/** 取消回弹：WAAPI 200ms ease-out 回原位 → 同任务先还原内联样式再撤动画
 * （终态 = 恒等变换，零闪烁）。无 WAAPI → 直接还原。 */
function settleBack(
  el: HTMLElement,
  tx: number,
  animRef: RefObject<Animation | null>,
  clearStyles: () => void,
): void {
  if (!hasMotionRuntime()) {
    clearStyles()
    return
  }
  const anim = el.animate(
    [{ transform: `translate3d(${tx}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
    { duration: EDGE_BACK_CANCEL_MS, easing: 'ease-out', fill: 'forwards' },
  )
  animRef.current = anim
  anim.onfinish = () => {
    if (animRef.current !== anim) return
    animRef.current = null
    clearStyles()
    anim.cancel()
  }
}
