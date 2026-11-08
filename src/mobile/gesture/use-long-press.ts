import { useEffect, useRef, type RefObject } from 'react'

import {
  DEFAULT_LONG_PRESS_CONFIG,
  exceedsMoveTolerance,
  isLongPressDwell,
  type LongPressConfig,
  type Point,
} from './long-press-decision'

/**
 * 长按手势 hook（M3-6 Files 长按操作单，HANDOFF §4.0-7）：pointer 事件采集
 * + 驻留计时。判定阈值全部在 long-press-decision.ts 纯函数里（可单测），本
 * hook 只做事件→计时→回调三段，全程零 React render（状态全在 ref）。
 *
 * 交互契约：
 * - **触屏与鼠标一致**：主键（touch/pen 恒主键；鼠标 button=0）按下即计时，
 *   驻留到阈确认 `onLongPress`；鼠标右键（button=2）不起长按（右键语义留给
 *   浏览器原生菜单，与改前一致）。
 * - **与「首击选中、再击打开」共存**（Files 窄容器语义，M2-5）：阈值内抬起
 *   = 正常点击——计时器撤销、click 抑制器从未挂上，click 原样交给行按钮；
 *   按下即计时对点击路径零感知。
 * - **位移超限取消**：pointermove 直线距离超容忍（滚动/拖拽意图）即撤销
 *   驻留，交互让位原生滚动；浏览器接管滚动即 pointercancel，同样静默复位
 *   （与 use-edge-back 的轴向 reject / pointercancel 同一让位哲学）。
 * - **确认后吞 click（仅限已消费的确认）**：长按确认（通常伴随浮层升起）
 *   后抬起会派发一枚落回原行按钮的 click——document 捕获段一次性吞掉，防止
 *   长按浮层打开的同一瞬间再触发行的点击语义；回调返回 false/void（未消费，
 *   委托宿主上没命中语义目标）则抑制器不挂、click 原样放行。抑制器 50ms
 *   内没等到 click 自拆（残留 = 吞掉后续一切点击，死按钮禁令，use-edge-back
 *   同款纪律）。
 * - **触屏长按的系统菜单/选择让位**：touch/pen 按压驻留期间的 contextmenu
 *   事件 preventDefault（Android 长按会在驻留中段派发 contextmenu，与操作
 *   单打架）；鼠标右键不拦（无活跃按压，浏览器菜单照旧）。文本选择让位由
 *   调用方在行上配 select-none（不属本 hook）。
 * - **容器委托**：监听挂调用方给的容器元素（Files 主列表 ul），一次挂载
 *   服务全部行，命中目标以 pointerdown 的 event.target 原样上交——语义
 *   解析（closest 找行）归调用方。
 *
 * 参数化（thresholdMs/moveTolerancePx）：后续长按消费方换一份 config 即可
 * 复用本 hook，判定代码零改动。
 */

/** click 抑制窗口：click 在 pointerup 之后派发（同任务/下一任务），抑制器
 * 必须活过这个间隙；该窗口内没等到 click 就自拆，绝不残留吞后续点击
 * （use-edge-back 同值同纪律）。 */
const CLICK_SUPPRESS_TEARDOWN_MS = 50

/** 长按确认事件：命中目标以 pointerdown 的最深元素上交（委托解析归调用方）。 */
export interface LongPressEvent {
  pointerId: number
  clientX: number
  clientY: number
  target: Element
}

export interface UseLongPressOptions {
  /** 事件宿主元素（容器委托：pointer 事件挂这里，后代命中原样上交）。
      宿主必须在 enabled 翻真时已在 DOM（应用根等稳定元素）——effect 只在
      enabled 变化时重挂，不追随后挂的子元素（列表晚于首帧挂载的消费方
      请委托到更外层的稳定宿主）。 */
  targetRef: RefObject<HTMLElement | null>
  /** 总开关（窄容器分支才 true）；false 时不挂监听、不留任何副作用。 */
  enabled: boolean
  /** 长按确认回调。返回 true = 本次确认已被消费（hook 吞掉紧随的 click，
      防止长按浮层升起后 click 落回原元素再触发点击语义）；返回
      false/void = 未消费（命中解析失败等）——抑制器不挂，click 原样放行
      （委托宿主大于语义目标时，未命中的长按绝不吞别人的点击）。 */
  onLongPress: (press: LongPressEvent) => boolean | void
  /** 判定参数（缺省 = 500ms 驻留 / 10px 位移容忍）。 */
  config?: Partial<LongPressConfig>
}

/** 一次按压的进行中状态（全部 ref，绝不进 React state）。 */
interface PressState {
  pointerId: number
  start: Point
  /** 驻留计时器（pointerup/pointercancel/超限位移时撤销）。 */
  timer: number
  /** 落下时刻（performance.now，ms）——到阈判定在纯函数。 */
  startTime: number
  /** pointerdown 命中的最深元素。 */
  target: Element
  /** 本轮是否已确认（确认后抬起不再撤销抑制窗口）。 */
  fired: boolean
  /** 确认是否已被回调消费（消费了才吞 click / 才需要退场兜底拆除）。 */
  claimed: boolean
}

export function useLongPress(options: UseLongPressOptions): void {
  const { targetRef, enabled } = options
  // 选项经 ref 透读：回调/配置逐次最新，effect 只依赖 enabled。
  const optionsRef = useRef(options)
  optionsRef.current = options

  const pressRef = useRef<PressState | null>(null)
  /** 确认后挂的一次性 click 抑制器（document 捕获段）。 */
  const clickSuppressRef = useRef<((event: MouseEvent) => void) | null>(null)
  /** 到期自拆计时器句柄（F2 审查：快速 re-arm 时旧定时器不得拆掉新一轮抑制器）。 */
  const suppressTeardownRef = useRef<number | null>(null)

  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

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
      // 一次性抑制器：吞掉长按落回原行的一枚 click 后自移除（残留会吞掉
      // 后续一切点击——死按钮禁令）。
      const suppress = (event: MouseEvent): void => {
        event.stopPropagation()
        event.preventDefault()
        document.removeEventListener('click', suppress, true)
        clickSuppressRef.current = null
      }
      document.addEventListener('click', suppress, true)
      clickSuppressRef.current = suppress
    }

    /** 抑制器只覆盖「确认后抬起紧随的那枚 click」窗口；没等到 click（手指
     * 移出起点元素等，浏览器不派发）也要到期自拆，防止吞掉下一次点击。 */
    const scheduleClickSuppressionTeardown = (): void => {
      if (suppressTeardownRef.current !== null) window.clearTimeout(suppressTeardownRef.current)
    suppressTeardownRef.current = window.setTimeout(() => {
      suppressTeardownRef.current = null
      stopClickSuppression()
    }, CLICK_SUPPRESS_TEARDOWN_MS)
    }

    /** 结束按压：撤计时器；已消费确认的轮次还要开 click 窗口兜底拆除。 */
    const endPress = (): void => {
      const press = pressRef.current
      if (!press) return
      window.clearTimeout(press.timer)
      pressRef.current = null
      if (press.fired && press.claimed) scheduleClickSuppressionTeardown()
    }

    const onPointerDown = (event: PointerEvent): void => {
      // 鼠标右键/中键不起长按（右键语义留给浏览器原生菜单，与改前一致）；
      // 进行中的按压不被第二枚指针接管。
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (pressRef.current !== null) return
      const target = event.target
      if (!(target instanceof Element)) return

      const config = { ...DEFAULT_LONG_PRESS_CONFIG, ...optionsRef.current.config }
      const start: Point = { x: event.clientX, y: event.clientY }
      const press: PressState = {
        pointerId: event.pointerId,
        start,
        startTime: performance.now(),
        timer: 0,
        target,
        fired: false,
        claimed: false,
      }
      press.timer = window.setTimeout(() => {
        // 到阈判定在纯函数：驻留不足（理论不发生，防计时器早到抖动）不确认。
        const current = pressRef.current
        if (current !== press || current.fired) return
        if (!isLongPressDwell(performance.now() - current.startTime, config)) return
        current.fired = true
        current.claimed =
          optionsRef.current.onLongPress({
            pointerId: current.pointerId,
            clientX: current.start.x,
            clientY: current.start.y,
            target: current.target,
          }) === true
        // 只吞「已消费」确认落回的 click：未消费（委托宿主上未命中语义
        // 目标）的长按绝不吞别人的点击——死按钮禁令同源纪律。
        if (current.claimed) armClickSuppression()
      }, config.thresholdMs)
      pressRef.current = press
    }

    const onPointerMove = (event: PointerEvent): void => {
      const press = pressRef.current
      if (press === null || event.pointerId !== press.pointerId || press.fired) return
      const config = { ...DEFAULT_LONG_PRESS_CONFIG, ...optionsRef.current.config }
      if (exceedsMoveTolerance(press.start, { x: event.clientX, y: event.clientY }, config)) {
        // 滚动/拖拽意图：撤销驻留，交互让位原生滚动（click 不吞，路径上
        // 从未挂抑制器）。
        endPress()
      }
    }

    const onFinish = (event: PointerEvent): void => {
      const press = pressRef.current
      if (press === null || event.pointerId !== press.pointerId) return
      // 阈值内抬起 = 正常点击（抑制器从未挂上，click 原样交给行按钮）；
      // 已确认的抬起 = click 窗口开启兜底拆除。
      endPress()
    }

    const onContextMenu = (event: MouseEvent): void => {
      // 仅拦触屏/笔驻留期间系统派发的 contextmenu（Android 长按中段派发，
      // 与操作单打架）；鼠标右键无活跃按压，浏览器菜单照旧（与改前一致）。
      if (pressRef.current !== null) event.preventDefault()
    }

    el.addEventListener('pointerdown', onPointerDown)
    // move/up/cancel 挂 window：笔/鼠标移出宿主后仍能收尾（否则 pressRef 悬挂）。
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onFinish)
    window.addEventListener('pointercancel', onFinish)
    el.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onFinish)
      window.removeEventListener('pointercancel', onFinish)
      el.removeEventListener('contextmenu', onContextMenu)
      endPress()
      stopClickSuppression()
    }
  }, [targetRef, enabled])
}