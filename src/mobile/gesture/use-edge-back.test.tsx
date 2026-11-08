import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'

import { useEdgeBack } from './use-edge-back'

/**
 * 边缘返回手势 hook 契约（M2-4；判定阈值语义归 edge-back-decision.test.ts，
 * MobileAppHost 集成归 MobileAppHost.test.tsx，真实触控时序归 E2E
 * e2e/mobile-edge-back.spec.ts）：
 * - 激活门：左缘 ≤24px 起点 + touch/pen 指针 + 目标不在 [data-no-edge-back]
 *   内；鼠标与非边缘起点不激活；
 * - 轴向：死区内 = 点击（不拦截 click）；纵向为主 = reject（不碰原生滚动）；
 * - 确认：过半或甩动 → onConfirm 恰一次；跟手 transform 逐帧直写（零
 *   React render），结束还原；
 * - 降级：followMotion=false（motion-prefs 关档）或 prefers-reduced-motion
 *   → 全程零 transform、确认直切；
 * - click 抑制器：激活拖拽后吞掉紧随的一枚 click 并自拆 + 到期兜底拆除，
 *   纯点击路径完全不挂。
 *
 * rAF/时钟用 fake timers 驱动（toFake performance/rAF/setTimeout）：jsdom
 * 无 WAAPI（Element.animate 缺席）→ 确认/取消都走「瞬时终态」降级分支，
 * 断言确定性不依赖真实帧率。
 */

const VW = { width: 400, height: 800 }

function Harness(props: {
  onConfirm: () => void
  followMotion?: boolean
  enabled?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEdgeBack({
    targetRef: ref,
    enabled: props.enabled ?? true,
    onConfirm: props.onConfirm,
    followMotion: props.followMotion ?? true,
    getViewport: () => VW,
  })
  return (
    <div ref={ref} data-testid="panel" style={{ width: VW.width, height: VW.height }}>
      <button type="button" data-testid="child">
        内容
      </button>
      <button type="button" data-testid="exempt" data-no-edge-back="">
        横向滚动面占位
      </button>
    </div>
  )
}

type PointerOpts = { x: number; y: number; pointerType?: string; pointerId?: number }

function pointer(target: Element, type: string, opts: PointerOpts): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: opts.pointerId ?? 1,
        pointerType: opts.pointerType ?? 'touch',
        clientX: opts.x,
        clientY: opts.y,
      }),
    )
  })
}

/** 驱动一段拖拽：down → 每点 move + 推一帧（rAF 采样）→ up。 */
function drag(
  target: Element,
  points: Array<PointerOpts>,
  opts: { advancePerMove?: number } = {},
): void {
  const [first, ...rest] = points
  pointer(target, 'pointerdown', first)
  for (const p of rest) {
    pointer(target, 'pointermove', p)
    act(() => {
      vi.advanceTimersByTime(opts.advancePerMove ?? 16)
    })
  }
  pointer(target, 'pointerup', points[points.length - 1]!)
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'],
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useEdgeBack 激活门', () => {
  it('非边缘起点（x>24）拖过半：不激活、零 transform、不确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    drag(panel, [
      { x: 100, y: 300 },
      { x: 250, y: 300 },
      { x: 340, y: 300 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
  })

  it('鼠标指针（横向拖拽留给文本选择）不激活', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    drag(panel, [
      { x: 10, y: 300, pointerType: 'mouse' },
      { x: 250, y: 300, pointerType: 'mouse' },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
  })

  it('起点在 [data-no-edge-back] 标记元素内：不激活（横向滚动面逃生口）', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)

    drag(screen.getByTestId('exempt'), [
      { x: 10, y: 300 },
      { x: 250, y: 300 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('panel').style.transform).toBe('')
  })

  it('enabled=false：挂了监听也整体沉默', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} enabled={false} />)

    drag(screen.getByTestId('panel'), [
      { x: 10, y: 300 },
      { x: 340, y: 300 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('panel').style.transform).toBe('')
  })

  it('手势进行中第二枚指针（pointerId 不同）不接管', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointerdown', { x: 380, y: 300, pointerId: 2 })
    // pointerId=2 的 move 不驱动采样：无 transform 写入。
    pointer(panel, 'pointermove', { x: 500, y: 300, pointerId: 2 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    pointer(panel, 'pointerup', { x: 500, y: 300, pointerId: 2 })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
  })
})

describe('useEdgeBack 轴向与点击共存', () => {
  it('纵向为主 → reject：不确认、不写 transform，click 不被吞（还给原生滚动）', () => {
    const onConfirm = vi.fn()
    const clicked = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')
    panel.addEventListener('click', clicked)

    drag(panel, [
      { x: 8, y: 100 },
      { x: 14, y: 200 },
      { x: 16, y: 300 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')

    // reject 后 click 正常派发（抑制器从未挂上）。
    fireEvent.click(panel)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('纯点击（死区内抬起）：click 照常触发（header 返回键与缘带重叠的安全线）', () => {
    const onConfirm = vi.fn()
    const clicked = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')
    panel.addEventListener('click', clicked)

    drag(panel, [
      { x: 10, y: 300 },
      { x: 12, y: 301 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(panel)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('激活拖拽后：紧随的一枚 click 被吞一次，抑制器自拆（不吞后续点击）', () => {
    const onConfirm = vi.fn()
    const clicked = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')
    panel.addEventListener('click', clicked)

    // 激活但取消（拖 50px 后停两拍再释放：采样速度衰减归零）：释放后
    // click 窗口开着。
    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 60, y: 305 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    pointer(panel, 'pointerup', { x: 60, y: 305 })
    fireEvent.click(panel)
    expect(clicked).not.toHaveBeenCalled()

    // 到期兜底拆除（50ms 窗口）：下一次 click 正常。
    act(() => {
      vi.advanceTimersByTime(50)
    })
    fireEvent.click(panel)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('pointercancel（原生滚动/系统手势接管）：静默复位，不确认、样式还原', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 120, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    // 已激活跟手：transform 在写。
    expect(panel.style.transform).not.toBe('')
    pointer(panel, 'pointercancel', { x: 120, y: 300 })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
    expect(panel.style.willChange).toBe('')
  })
})

describe('useEdgeBack 确认判定与跟手', () => {
  it('拖过半（>200px）：跟手 transform 逐帧直写，释放确认恰一次并还原样式', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 130, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    // 跟手中：1:1 位移直写 DOM（零 render 的证据 = ref 面板仍在原位渲染）。
    expect(panel.style.transform).toBe('translate3d(120px, 0, 0)')
    expect(panel.style.willChange).toBe('transform')

    pointer(panel, 'pointermove', { x: 250, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(panel.style.transform).toBe('translate3d(240px, 0, 0)')

    pointer(panel, 'pointerup', { x: 250, y: 300 })
    // jsdom 无 WAAPI → 瞬时终态：立即确认 + 样式还原。
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(panel.style.transform).toBe('')
    expect(panel.style.willChange).toBe('')
    expect(panel.style.userSelect).toBe('')
  })

  it('快速甩动（距离 < 半屏、速度 ≥0.5px/ms）也确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 40, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    pointer(panel, 'pointermove', { x: 90, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    pointer(panel, 'pointerup', { x: 90, y: 300 })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('合并单跳快甩（唯一 move 在终点位置）：起点参与速度窗，速度不误判为 0', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    // 真实快甩被 Chromium 合并后常只剩一枚终点 move（5→145 一跳）：轨迹
    // 事件位移差恒 0，速度窗必须落到 pointerdown 起点（窗内最老点）才能
    // 还原 140px/~50ms 的真实甩速。
    pointer(panel, 'pointerdown', { x: 5, y: 300 })
    act(() => {
      vi.advanceTimersByTime(50)
    })
    pointer(panel, 'pointermove', { x: 145, y: 300 })
    pointer(panel, 'pointerup', { x: 145, y: 300 })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('一帧内完成的快甩（释放早于首个 rAF）：落下起平均速度兜底确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    // 落下后推时钟（此刻无 pending rAF，不产生采样），move+up 同帧完成：
    // lastSample 全程为 null → 走平均速度兜底（140px / 40ms = 3.5 ≥ 0.5）。
    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    act(() => {
      vi.advanceTimersByTime(40)
    })
    pointer(panel, 'pointermove', { x: 150, y: 300 })
    pointer(panel, 'pointerup', { x: 150, y: 300 })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('短慢拖（<半屏且速度不足）：取消回弹，不确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 60, y: 300 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    pointer(panel, 'pointermove', { x: 130, y: 300 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    pointer(panel, 'pointerup', { x: 130, y: 300 })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(panel.style.transform).toBe('')
  })

  it('向外拖（位移为负）：不激活', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    drag(panel, [
      { x: 20, y: 300 },
      { x: 2, y: 300 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('取消后新一轮手势照常工作（状态完全复位）', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    // 第一轮：拖 50px 后停两拍（速度衰减归零）→ 取消。
    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 60, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    pointer(panel, 'pointerup', { x: 60, y: 300 })
    expect(onConfirm).not.toHaveBeenCalled()

    // 第二轮：完整距离确认（状态已复位）。
    drag(panel, [
      { x: 10, y: 300 },
      { x: 250, y: 300 },
    ])
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('useEdgeBack 动效降级（直切）', () => {
  it('followMotion=false（motion-prefs 转场关档）：零 transform，确认直切', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} followMotion={false} />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 340, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(panel.style.transform).toBe('')
    expect(panel.style.willChange).toBe('')

    pointer(panel, 'pointerup', { x: 340, y: 300 })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('prefers-reduced-motion 生效：零 transform，确认直切（hook 落下时探测）', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMediaMock)
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} followMotion />)
    const panel = screen.getByTestId('panel')

    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 340, y: 300 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(panel.style.transform).toBe('')

    pointer(panel, 'pointerup', { x: 340, y: 300 })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})

describe('抑制器到期句柄与 viewport 缓存（F2 审查）', () => {
  it('到期自拆不再误拆 re-arm 的新抑制器：第二轮手势后的 click 仍被吞', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const panel = screen.getByTestId('panel')

    // 第一轮：落下→位移激活→释放（调度 50ms 到期自拆）。
    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 340, y: 300 })
    pointer(panel, 'pointerup', { x: 340, y: 300 })
    act(() => {
      vi.advanceTimersByTime(49)
    })

    // 50ms 窗口内立即再拖拽（re-arm 新抑制器）。
    pointer(panel, 'pointerdown', { x: 10, y: 300 })
    pointer(panel, 'pointermove', { x: 340, y: 300 })
    // 旧定时器到点：不得拆掉第二轮刚挂的抑制器。
    act(() => {
      vi.advanceTimersByTime(1)
    })
    pointer(panel, 'pointerup', { x: 340, y: 300 })

    // 第二轮释放后的合成 click 被第二轮抑制器吞掉（激活路径消费，不冒泡）。
    const child = screen.getByTestId('child')
    child.addEventListener('click', (event) => event.stopPropagation())
    fireEvent.click(panel)
    expect(onConfirm).toHaveBeenCalledTimes(2) // 两轮 edge-back 确认各一次
  })
})
