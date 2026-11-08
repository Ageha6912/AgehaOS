import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetFocusTilt, useFocusTilt } from './use-focus-tilt'

function TiltHarness({ focused, minimized }: { focused: boolean; minimized: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useFocusTilt(ref, focused, minimized, true)
  return <div ref={ref} data-testid="tilt-target" />
}

let animate: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetFocusTilt()
  animate = vi.fn(() => ({ cancel: vi.fn() }))
  // jsdom 没有 WAAPI：装一个可断言的 animate（只关心是否启动，不关心帧）。
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    value: animate,
    configurable: true,
  })
})

afterEach(() => {
  delete (HTMLElement.prototype as { animate?: unknown }).animate
  vi.restoreAllMocks()
})

describe('useFocusTilt（§32.5 修订 10）', () => {
  it('plays the tilt only on a genuine focus migration', () => {
    const { rerender } = render(<TiltHarness focused={false} minimized={false} />)
    expect(animate).not.toHaveBeenCalled()

    rerender(<TiltHarness focused={true} minimized={false} />)
    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('yields to the minimize-restore flight instead of overlaying a second animation (E2 审查)', () => {
    const { rerender } = render(<TiltHarness focused={true} minimized={false} />)
    expect(animate).not.toHaveBeenCalled()

    // 最小化：focused 同时变 false。
    rerender(<TiltHarness focused={false} minimized={true} />)
    expect(animate).not.toHaveBeenCalled()

    // 还原：同一提交里 focused=true && minimized=false——genie 动画独占
    // transform/opacity，聚焦转场必须让位（旧实现后创建动画覆盖飞行路径）。
    rerender(<TiltHarness focused={true} minimized={false} />)
    expect(animate).not.toHaveBeenCalled()
  })
})
