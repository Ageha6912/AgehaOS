import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'

import { useDockWave } from './use-dock-wave'

/**
 * 测试台：容器 + 三个 data-wave-icon 图标（中心 x = 20/120/220，间距 100px）。
 * rect 手动 mock（jsdom 零矩形）；fake timers 连 rAF 一起接管（16ms 帧距），
 * advanceTimersByTime 驱动引擎帧（与 boot-motion 测试同一手法）。
 * pointerenter/move 用 MouseEvent 派发（无 pointerType → 非 touch，走波浪路径）。
 */
function Harness(): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useDockWave(ref)
  return (
    <div ref={ref} data-testid="wave-row" style={{ width: 300, height: 48 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} data-testid={`icon-${i}`} data-wave-icon style={{ width: 40, height: 40 }} />
      ))}
    </div>
  )
}

function mockIconRects(): HTMLElement[] {
  const icons = [0, 1, 2].map((i) =>
    document.querySelector<HTMLElement>(`[data-testid="icon-${i}"]`),
  )
  icons.forEach((el, i) => {
    if (!el) throw new Error(`icon-${i} missing`)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: i * 100,
      top: 4,
      width: 40,
      height: 40,
      right: i * 100 + 40,
      bottom: 44,
      x: i * 100,
      y: 4,
      toJSON: () => ({}),
    } as DOMRect)
  })
  return icons as HTMLElement[]
}

const enter = (row: HTMLElement, clientX: number) =>
  fireEvent(row, new MouseEvent('pointerenter', { clientX, bubbles: false }))
const move = (row: HTMLElement, clientX: number) =>
  fireEvent(row, new MouseEvent('pointermove', { clientX, bubbles: false }))
const leave = (row: HTMLElement) =>
  fireEvent(row, new MouseEvent('pointerleave', { bubbles: false }))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useDockWave（任务栏波浪引擎，DESIGN.md §13）', () => {
  it('writes the gaussian wave on enter: nearest icon peaks, far icon stays identity', () => {
    const { getByTestId } = render(<Harness />)
    const row = getByTestId('wave-row')
    const icons = mockIconRects()

    act(() => {
      enter(row, 20) // 指针落在图标 0 中心
      vi.advanceTimersByTime(300) // 包络 120ms 满格 + 若干帧
    })

    expect(icons[0].style.transform).toBe('translateY(-3.00px) scale(1.5000)') // 波峰
    // 图标 1 距 100px：1 + 0.5·e^(-100²/2·44²) ≈ 1.0377
    expect(icons[1].style.transform).toContain('scale(1.037')
    // 图标 2 距 200px：波形 ≈ 1（低于阈值不写）
    expect(icons[2].style.transform).toBe('')
    // will-change 仅动效期间挂载
    expect(icons[0].style.willChange).toBe('transform')
  })

  it('follows the pointer 1:1 on move', () => {
    const { getByTestId } = render(<Harness />)
    const row = getByTestId('wave-row')
    const icons = mockIconRects()

    act(() => {
      enter(row, 20)
      vi.advanceTimersByTime(300)
    })
    act(() => {
      move(row, 220) // 移到图标 2 中心
      vi.advanceTimersByTime(300)
    })

    expect(icons[2].style.transform).toBe('translateY(-3.00px) scale(1.5000)')
    // 波峰移走后：图标 0 从 1.5 回落到恒等缩放（变化阈值内写一次；完全收敛才清空）
    expect(icons[0].style.transform).toEqual(
      expect.stringMatching(/scale\(1\.0000\)$/),
    )
  })

  it('settles and clears poses after pointerleave', () => {
    const { getByTestId } = render(<Harness />)
    const row = getByTestId('wave-row')
    const icons = mockIconRects()

    act(() => {
      enter(row, 20)
      vi.advanceTimersByTime(300)
    })
    act(() => {
      leave(row)
      vi.advanceTimersByTime(400) // 收敛 200ms + 帧
    })

    for (const icon of icons) {
      expect(icon.style.transform).toBe('')
      expect(icon.style.willChange).toBe('')
    }
  })

  it('does not start for touch pointers', () => {
    const { getByTestId } = render(<Harness />)
    const row = getByTestId('wave-row')
    const icons = mockIconRects()

    act(() => {
      const event = new MouseEvent('pointerenter', { clientX: 20, bubbles: false })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      fireEvent(row, event)
      vi.advanceTimersByTime(300)
    })

    expect(icons[0].style.transform).toBe('')
    expect(icons[0].style.willChange).toBe('')
  })

  it('stays inert under prefers-reduced-motion (hover color from CSS remains)', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const { getByTestId } = render(<Harness />)
    const row = getByTestId('wave-row')
    const icons = mockIconRects()

    act(() => {
      enter(row, 20)
      vi.advanceTimersByTime(300)
    })

    expect(icons[0].style.transform).toBe('')
    expect(icons[0].style.willChange).toBe('')
  })

  it('stops scheduling frames once hovered and static (converge-stop)', () => {
    const { getByTestId } = render(<Harness />)
    const row = getByTestId('wave-row')
    mockIconRects()
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

    act(() => {
      enter(row, 20)
      vi.advanceTimersByTime(300)
    })
    rafSpy.mockClear()

    act(() => {
      vi.advanceTimersByTime(200) // 指针静止：不应再排帧
    })
    expect(rafSpy).not.toHaveBeenCalled()

    act(() => {
      move(row, 60) // 移动唤醒
      vi.advanceTimersByTime(50)
    })
    expect(rafSpy).toHaveBeenCalled()
  })

  it('removes listeners and poses on unmount', () => {
    const { getByTestId, unmount } = render(<Harness />)
    const row = getByTestId('wave-row')
    const icons = mockIconRects()

    act(() => {
      enter(row, 20)
      vi.advanceTimersByTime(300)
    })
    act(() => {
      unmount()
    })

    expect(icons[0].style.transform).toBe('')
    expect(icons[0].style.willChange).toBe('')
  })
})
