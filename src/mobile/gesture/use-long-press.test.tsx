import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'

import { useLongPress } from './use-long-press'

/**
 * 长按手势 hook 契约（M3-6；判定阈值语义归 long-press-decision.test.ts，
 * FileManager 集成归 FileManager.test.tsx 窄容器组，真实触控时序归
 * e2e/mobile-files.spec.ts）：
 * - 驻留到阈确认恰一次；阈值内抬起 = 正常点击（不确认、click 不吞）；
 * - 位移超限取消、pointercancel 静默复位；容忍内微动不取消；
 * - 确认后紧随的一枚 click 被吞一次 + 到期兜底自拆（不吞后续点击）；
 * - 触屏与鼠标（左键）一致；鼠标右键不起长按、驻留期 contextmenu 只在
 *   touch/pen 按压时被拦（鼠标右键菜单照旧）；
 * - enabled=false 整体沉默；第二枚指针不接管；卸载清理。
 *
 * 时钟用 fake timers 驱动（toFake performance/setTimeout）：到阈判定读
 * performance.now，vitest fake 时钟随 advanceTimersByTime 一并推进。
 */

function Harness(props: {
  onLongPress: (press: { target: Element }) => boolean | void
  enabled?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLongPress({ targetRef: ref, enabled: props.enabled ?? true, onLongPress: props.onLongPress })
  return (
    <div ref={ref} data-testid="press-area">
      <button type="button" data-testid="row">
        行
      </button>
    </div>
  )
}

type PointerOpts = { x?: number; y?: number; pointerType?: string; pointerId?: number; button?: number }

function pointer(target: Element, type: string, opts: PointerOpts = {}): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: opts.pointerId ?? 1,
        pointerType: opts.pointerType ?? 'touch',
        button: opts.button ?? 0,
        clientX: opts.x ?? 10,
        clientY: opts.y ?? 10,
      }),
    )
  })
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['performance', 'setTimeout', 'clearTimeout'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLongPress 驻留确认', () => {
  it('驻留 500ms 确认恰一次，命中目标 = pointerdown 的最深元素', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown', { x: 10, y: 10 })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress.mock.calls[0]?.[0].target).toBe(row)

    // 确认后计时器不再重放：继续驻留不重复确认。
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('阈值内抬起 = 正常点击：不确认、click 原样触发（抑制器从未挂上）', () => {
    const onLongPress = vi.fn()
    const clicked = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')
    row.addEventListener('click', clicked)

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(120)
    })
    pointer(row, 'pointerup')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(row)

    expect(onLongPress).not.toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('确认后抬起：紧随的一枚 click 被吞一次，抑制器到期自拆（不吞后续点击）', () => {
    const onLongPress = vi.fn(() => true)
    const clicked = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')
    row.addEventListener('click', clicked)

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup')
    fireEvent.click(row)
    expect(clicked).not.toHaveBeenCalled()

    // 50ms 窗口到期兜底拆除：下一次 click 正常。
    act(() => {
      vi.advanceTimersByTime(50)
    })
    fireEvent.click(row)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('回调未消费确认（返回 false）：click 原样放行（委托宿主上未命中语义目标）', () => {
    const onLongPress = vi.fn(() => false)
    const clicked = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')
    row.addEventListener('click', clicked)

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup')
    fireEvent.click(row)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('确认后新一轮按压照常工作（状态完全复位）', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup')

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup')

    expect(onLongPress).toHaveBeenCalledTimes(2)
  })
})

describe('useLongPress 取消路径', () => {
  it('位移超限（>10px）撤销驻留：滚动/拖拽意图让位，click 不吞', () => {
    const onLongPress = vi.fn()
    const clicked = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')
    row.addEventListener('click', clicked)

    pointer(row, 'pointerdown', { x: 100, y: 300 })
    pointer(row, 'pointermove', { x: 130, y: 300 })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    pointer(row, 'pointerup')
    fireEvent.click(row)

    expect(onLongPress).not.toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('容忍内微动（≤10px）不取消：驻留照常到阈', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown', { x: 100, y: 300 })
    pointer(row, 'pointermove', { x: 106, y: 308 })
    pointer(row, 'pointermove', { x: 104, y: 303 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup')

    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('pointercancel（浏览器接管滚动）静默复位：不确认、click 不吞', () => {
    const onLongPress = vi.fn()
    const clicked = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')
    row.addEventListener('click', clicked)

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    pointer(row, 'pointercancel')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(row)

    expect(onLongPress).not.toHaveBeenCalled()
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('取消后新一轮按压照常确认（状态完全复位）', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown', { x: 100, y: 300 })
    pointer(row, 'pointermove', { x: 160, y: 300 })
    pointer(row, 'pointerup')
    expect(onLongPress).not.toHaveBeenCalled()

    pointer(row, 'pointerdown', { x: 100, y: 300 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup')
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })
})

describe('useLongPress 指针门', () => {
  it('鼠标左键长按同样确认（触屏与鼠标一致）', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown', { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup', { pointerType: 'mouse' })

    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('鼠标右键（button=2）不起长按', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown', { pointerType: 'mouse', button: 2 })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    pointer(row, 'pointerup', { pointerType: 'mouse', button: 2 })

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('touch/pen 驻留期间 contextmenu 被 preventDefault（系统长按菜单让位）', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const area = screen.getByTestId('press-area')
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => {
      area.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)

    // 结束按压后 contextmenu 不再被拦（无活跃按压）。
    pointer(row, 'pointerup')
    const later = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => {
      area.dispatchEvent(later)
    })
    expect(later.defaultPrevented).toBe(false)
    expect(onLongPress).not.toHaveBeenCalled() // 500ms 未到
  })

  it('进行中按压不被第二枚指针接管', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown', { pointerId: 1 })
    pointer(row, 'pointerdown', { pointerId: 2 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    pointer(row, 'pointerup', { pointerId: 2 })

    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress.mock.calls[0]?.[0].target).toBe(row)
  })

  it('enabled=false：整体沉默', () => {
    const onLongPress = vi.fn()
    render(<Harness onLongPress={onLongPress} enabled={false} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    pointer(row, 'pointerup')

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('卸载清理：确认前卸载，计时器不再触发', () => {
    const onLongPress = vi.fn()
    const { unmount } = render(<Harness onLongPress={onLongPress} />)
    const row = screen.getByTestId('row')

    pointer(row, 'pointerdown')
    unmount()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(onLongPress).not.toHaveBeenCalled()
  })
})
