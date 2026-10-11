import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDockHomeGesture } from './use-dock-home-gesture'

/**
 * M3-2 Dock Home 位手势 hook 契约（判定阈值归 dock-home-gesture.test.ts）：
 * - 短按（位移未出死区、按压未满 holdMs）→ 不分发任何回调，click 原样
 *   保留（短按回 Home 是按钮原生 onClick）；
 * - 长按 holdMs 到点 → onLongPress 恰一次，随后 pointerup 不再判定，紧随
 *   的 click 被一次性抑制器吞掉（不会「开完最近任务又回 Home」）；
 * - 按住中位移出死区 → 长按定时器撤销，改走释放判定：上滑过阈 →
 *   onSwipeUp + click 吞掉；位移不足 → click 放行；
 * - pointercancel → 静默复位；鼠标指针不激活；同一时间只认一轮手势。
 */

/** hook 挂在按钮自身（真实挂载点 = MobileDock Home 位按钮）。 */
function renderProbe(overrides?: {
  onLongPress?: () => void
  onSwipeUp?: () => void
  onClick?: () => void
}): {
  longPress: ReturnType<typeof vi.fn>
  swipeUp: ReturnType<typeof vi.fn>
  click: ReturnType<typeof vi.fn>
} {
  const longPress = vi.fn()
  const swipeUp = vi.fn()
  const click = vi.fn()
  function Probe() {
    useDockHomeGesture({
      targetRef: probeRef,
      onLongPress: overrides?.onLongPress ?? longPress,
      onSwipeUp: overrides?.onSwipeUp ?? swipeUp,
    })
    return (
      <button type="button" data-testid="probe" ref={probeRef} onClick={overrides?.onClick ?? click}>
        probe
      </button>
    )
  }
  render(<Probe />)
  return { longPress, swipeUp, click }
}

const probeRef: { current: HTMLButtonElement | null } = { current: null }

beforeEach(() => {
  probeRef.current = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDockHomeGesture', () => {
  function pointer(type: string, x: number, y: number, pointerType = 'touch', pointerId = 1): void {
    act(() => {
      screen.getByTestId('probe').dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType,
          clientX: x,
          clientY: y,
        }),
      )
    })
  }

  it('短按（按压未满 holdMs、位移未出死区）：零回调，click 原样派发', () => {
    vi.useFakeTimers()
    const { longPress, swipeUp, click } = renderProbe()

    pointer('pointerdown', 36, 760)
    vi.advanceTimersByTime(200)
    pointer('pointerup', 36, 760)
    fireEvent.click(screen.getByTestId('probe'))

    expect(longPress).not.toHaveBeenCalled()
    expect(swipeUp).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('长按 holdMs 到点：onLongPress 恰一次；释放不再判定、click 被吞', () => {
    vi.useFakeTimers()
    const { longPress, swipeUp, click } = renderProbe()

    pointer('pointerdown', 36, 760)
    vi.advanceTimersByTime(500)
    expect(longPress).toHaveBeenCalledTimes(1)

    pointer('pointerup', 36, 760)
    fireEvent.click(screen.getByTestId('probe'))

    expect(longPress).toHaveBeenCalledTimes(1)
    expect(swipeUp).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('长按后继续按住远超抑制窗口再释放：click 仍被吞（抑制挂在释放时刻）', () => {
    vi.useFakeTimers()
    const { longPress, click } = renderProbe()

    pointer('pointerdown', 36, 760)
    vi.advanceTimersByTime(500)
    expect(longPress).toHaveBeenCalledTimes(1)
    // 用户又按了 3 秒（click 晚于 50ms 抑制窗口很久）。
    vi.advanceTimersByTime(3000)
    pointer('pointerup', 36, 760)
    fireEvent.click(screen.getByTestId('probe'))

    expect(click).not.toHaveBeenCalled()
  })

  it('按压中位移出死区：长按定时器撤销；释放上滑过阈 → onSwipeUp + click 吞', () => {
    vi.useFakeTimers()
    const { longPress, swipeUp, click } = renderProbe()

    pointer('pointerdown', 36, 770)
    pointer('pointermove', 36, 755) // 出死区（15px）
    vi.advanceTimersByTime(2000) // 远超 holdMs：定时器已撤，不得触发
    pointer('pointerup', 36, 700) // 上滑 70px

    fireEvent.click(screen.getByTestId('probe'))

    expect(longPress).not.toHaveBeenCalled()
    expect(swipeUp).toHaveBeenCalledTimes(1)
    expect(click).not.toHaveBeenCalled()
  })

  it('位移出死区但释放不足上滑阈值：零回调，click 放行（横向滑等）', () => {
    vi.useFakeTimers()
    const { longPress, swipeUp, click } = renderProbe()

    pointer('pointerdown', 36, 770)
    pointer('pointermove', 60, 770) // 横向出死区
    vi.advanceTimersByTime(2000)
    pointer('pointerup', 70, 770)

    fireEvent.click(screen.getByTestId('probe'))

    expect(longPress).not.toHaveBeenCalled()
    expect(swipeUp).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('pointercancel：静默复位（长按不触发、click 不吞）', () => {
    vi.useFakeTimers()
    const { longPress, swipeUp, click } = renderProbe()

    pointer('pointerdown', 36, 760)
    vi.advanceTimersByTime(200)
    pointer('pointercancel', 36, 760)
    vi.advanceTimersByTime(2000)
    fireEvent.click(screen.getByTestId('probe'))

    expect(longPress).not.toHaveBeenCalled()
    expect(swipeUp).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('鼠标指针不激活（长按是选择/右键语义）', () => {
    vi.useFakeTimers()
    const { longPress, swipeUp } = renderProbe()

    pointer('pointerdown', 36, 760, 'mouse')
    vi.advanceTimersByTime(2000)
    pointer('pointerup', 36, 660, 'mouse')

    expect(longPress).not.toHaveBeenCalled()
    expect(swipeUp).not.toHaveBeenCalled()
  })

  it('第二轮指针不接管进行中的手势（首轮照常长按确认）', () => {
    vi.useFakeTimers()
    const { longPress } = renderProbe()

    pointer('pointerdown', 36, 760, 'touch', 1)
    pointer('pointerdown', 100, 700, 'touch', 2)
    pointer('pointerup', 100, 700, 'touch', 2) // 第二轮抬起不影响第一轮
    vi.advanceTimersByTime(500)
    pointer('pointerup', 36, 760, 'touch', 1)

    expect(longPress).toHaveBeenCalledTimes(1)
  })
})
