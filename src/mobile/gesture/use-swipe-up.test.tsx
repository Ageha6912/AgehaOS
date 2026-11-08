import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'

import { useSwipeUp } from './use-swipe-up'

/**
 * 上滑唤起启动器 hook 契约（M3-1；判定阈值语义归 swipe-up-decision.test.ts，
 * MobileShell 接线归 MobileShell.test.tsx，真实触控时序归 e2e
 * mobile-swipe-up-launcher.spec.ts）：
 * - 激活门：底缘 ≤72px 起点 + touch/pen 指针 + 目标不在 [data-no-edge-back]
 *   内；鼠标与非底缘起点不激活；
 * - 轴向：死区内 = 点击（不拦截 click）；横向为主/向下 = reject；
 * - 确认：距离档或甩动档 → onConfirm 恰一次；跟手 transform 逐帧直写
 *   （零 React render）且钳 80px，释放回弹还原；
 * - 降级：followMotion=false（motion-prefs 关档）或 prefers-reduced-motion
 *   → 全程零 transform、确认直开；
 * - click 抑制器：激活拖拽后吞掉紧随的一枚 click 并自拆 + 到期兜底拆除，
 *   纯点击路径完全不挂。
 *
 * rAF/时钟用 fake timers 驱动（toFake performance/rAF/setTimeout）：jsdom
 * 无 WAAPI（Element.animate 缺席）→ 回弹走「瞬时终态」降级分支，断言
 * 确定性不依赖真实帧率。
 */

const VW = { width: 400, height: 800 }

function Harness(props: {
  onConfirm: () => void
  followMotion?: boolean
  enabled?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useSwipeUp({
    targetRef: ref,
    enabled: props.enabled ?? true,
    onConfirm: props.onConfirm,
    followMotion: props.followMotion ?? true,
    getViewport: () => VW,
  })
  return (
    <div ref={ref} data-testid="dock-zone" style={{ width: VW.width, height: 90 }}>
      <button type="button" data-testid="dock-button">
        Dock 位
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

describe('useSwipeUp 激活门', () => {
  it('底缘带内起点（y=770）上滑 150px（> 0.15×800）：确认恰一次', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    drag(zone, [
      { x: 180, y: 770 },
      { x: 180, y: 690 },
      { x: 180, y: 620 },
    ])

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('带外起点（y=600，内容区一侧）：不激活、零 transform、不确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    drag(zone, [
      { x: 180, y: 600 },
      { x: 180, y: 450 },
      { x: 180, y: 300 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
  })

  it('鼠标指针不激活（桌面 Shell 不挂本 hook，鼠标拖拽留给文本选择）', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    drag(zone, [
      { x: 180, y: 770, pointerType: 'mouse' },
      { x: 180, y: 600, pointerType: 'mouse' },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
  })

  it('起点在 [data-no-edge-back] 标记元素内：不激活（手势家族统一逃生口）', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)

    drag(screen.getByTestId('exempt'), [
      { x: 180, y: 780 },
      { x: 180, y: 600 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('dock-zone').style.transform).toBe('')
  })

  it('enabled=false（Launcher 打开/应用视图）：挂了监听也整体沉默', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} enabled={false} />)

    drag(screen.getByTestId('dock-zone'), [
      { x: 180, y: 770 },
      { x: 180, y: 600 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('dock-zone').style.transform).toBe('')
  })

  it('手势进行中第二枚指针（pointerId 不同）不接管', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointerdown', { x: 200, y: 770, pointerId: 2 })
    pointer(zone, 'pointermove', { x: 200, y: 500, pointerId: 2 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    pointer(zone, 'pointerup', { x: 200, y: 500, pointerId: 2 })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
  })
})

describe('useSwipeUp 轴向与点击共存', () => {
  it('横向为主 → reject：不确认、不写 transform，click 不被吞', () => {
    const onConfirm = vi.fn()
    const clicked = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')
    zone.addEventListener('click', clicked)

    drag(zone, [
      { x: 10, y: 780 },
      { x: 90, y: 776 },
      { x: 170, y: 776 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
    fireEvent.click(zone)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('向下拖 → reject：不确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    drag(zone, [
      { x: 180, y: 760 },
      { x: 180, y: 790 },
      { x: 180, y: 795 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
  })

  it('纯点击（死区内抬起）：click 照常触发（Dock 位 44×44 命中区的安全线）', () => {
    const onConfirm = vi.fn()
    const clicked = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')
    zone.addEventListener('click', clicked)

    drag(zone, [
      { x: 180, y: 770 },
      { x: 182, y: 772 },
    ])

    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(zone)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('激活拖拽后：紧随的一枚 click 被吞一次，抑制器自拆（不吞后续点击）', () => {
    const onConfirm = vi.fn()
    const clicked = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')
    zone.addEventListener('click', clicked)

    // 激活但取消（拖 30px 后停两拍再释放：速度窗口衰减归零）→ 释放后
    // click 窗口开着。
    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointermove', { x: 180, y: 740 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    pointer(zone, 'pointerup', { x: 180, y: 740 })
    fireEvent.click(zone)
    expect(clicked).not.toHaveBeenCalled()

    // 到期兜底拆除（50ms 窗口）：下一次 click 正常。
    act(() => {
      vi.advanceTimersByTime(50)
    })
    fireEvent.click(zone)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('pointercancel（系统手势接管）：静默复位，不确认、样式还原', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointermove', { x: 180, y: 700 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    // 跟手中：1:1 上抬直写 DOM。
    expect(zone.style.transform).toBe('translate3d(0, -70px, 0)')
    pointer(zone, 'pointercancel', { x: 180, y: 700 })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
    expect(zone.style.willChange).toBe('')
  })
})

describe('useSwipeUp 确认判定与跟手', () => {
  it('跟手 transform 逐帧直写（零 render）且钳 80px：拖 200px 只抬到 -80', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 780 })
    pointer(zone, 'pointermove', { x: 180, y: 730 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(zone.style.transform).toBe('translate3d(0, -50px, 0)')
    expect(zone.style.willChange).toBe('transform')

    pointer(zone, 'pointermove', { x: 180, y: 580 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    // 200px 位移 > followMaxPx：钳 80。
    expect(zone.style.transform).toBe('translate3d(0, -80px, 0)')

    pointer(zone, 'pointerup', { x: 180, y: 580 })
    // jsdom 无 WAAPI → 瞬时终态：立即确认 + 样式还原。
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(zone.style.transform).toBe('')
    expect(zone.style.willChange).toBe('')
    expect(zone.style.userSelect).toBe('')
  })

  it('快速上甩（距离 < 0.15×800、速度 ≥0.5px/ms）也确认', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    // 距离 60 < 120：单跳合成甩动，起点参与速度窗还原真实甩速。
    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    act(() => {
      vi.advanceTimersByTime(40)
    })
    pointer(zone, 'pointermove', { x: 180, y: 710 })
    pointer(zone, 'pointerup', { x: 180, y: 710 })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('短慢拖（<距离档且末帧沉速）：取消，不确认、样式还原', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointermove', { x: 180, y: 740 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    pointer(zone, 'pointermove', { x: 180, y: 700 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    pointer(zone, 'pointerup', { x: 180, y: 700 })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(zone.style.transform).toBe('')
  })

  it('取消后新一轮手势照常工作（状态完全复位）', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    // 第一轮：拖 30px 后停两拍（速度衰减归零）→ 取消。
    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointermove', { x: 180, y: 740 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    pointer(zone, 'pointerup', { x: 180, y: 740 })
    expect(onConfirm).not.toHaveBeenCalled()

    // 第二轮：完整距离确认（状态已复位）。
    drag(zone, [
      { x: 180, y: 770 },
      { x: 180, y: 620 },
    ])
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('useSwipeUp 动效降级（直开）', () => {
  it('followMotion=false（motion-prefs 转场关档）：零 transform，确认直开', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} followMotion={false} />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointermove', { x: 180, y: 600 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(zone.style.transform).toBe('')
    expect(zone.style.willChange).toBe('')

    pointer(zone, 'pointerup', { x: 180, y: 600 })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('prefers-reduced-motion 生效：零 transform，确认直开（hook 落下时探测）', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMediaMock)
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} followMotion />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 770 })
    pointer(zone, 'pointermove', { x: 180, y: 600 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(zone.style.transform).toBe('')

    pointer(zone, 'pointerup', { x: 180, y: 600 })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('指针移出宿主后仍在 window 上完成手势（pen 无隐式捕获）', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const zone = screen.getByTestId('dock-zone')

    pointer(zone, 'pointerdown', { x: 180, y: 770, pointerType: 'pen', pointerId: 9 })
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 9,
          pointerType: 'pen',
          clientX: 180,
          clientY: 600,
        }),
      )
      vi.advanceTimersByTime(16)
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 9,
          pointerType: 'pen',
          clientX: 180,
          clientY: 600,
        }),
      )
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
