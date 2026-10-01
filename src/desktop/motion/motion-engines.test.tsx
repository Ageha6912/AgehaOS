import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'

import { GLOW_SIZE_PX, useCursorGlow } from './use-cursor-glow'

/**
 * rAF/几何手动驱动测试台（与 boot-motion 同一手法的桌面增强版）：
 * fake timers 接管 rAF（16ms 帧距），rect 用 mock 注入。
 */

function GlowHarness({ enabled }: { enabled: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const orbRef = useRef<HTMLDivElement | null>(null)
  useCursorGlow(hostRef, orbRef, enabled)
  return (
    <div ref={hostRef} data-testid="glow-host" style={{ width: 800, height: 600 }}>
      <div ref={orbRef} data-testid="glow-orb" />
    </div>
  )
}

function mockRect(el: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useCursorGlow（指针光晕，DESIGN.md §15）', () => {
  it('follows the pointer with easing and shows the orb via is-visible', () => {
    const { getByTestId } = render(<GlowHarness enabled />)
    const host = getByTestId('glow-host')
    const orb = getByTestId('glow-orb')
    mockRect(host, {})

    act(() => {
      host.dispatchEvent(new MouseEvent('pointerenter', { clientX: 400, clientY: 300 }))
    })
    expect(orb.classList.contains('is-visible')).toBe(true)
    // 首现就地亮起：transform 立即到位（-half 居中）
    expect(orb.style.transform).toBe(`translate3d(${400 - GLOW_SIZE_PX / 2}.0px, ${300 - GLOW_SIZE_PX / 2}.0px, 0)`)
  })

  it('hides the orb on leave and clears state on unmount', () => {
    const { getByTestId, unmount } = render(<GlowHarness enabled />)
    const host = getByTestId('glow-host')
    const orb = getByTestId('glow-orb')
    mockRect(host, {})
    act(() => {
      host.dispatchEvent(new MouseEvent('pointerenter', { clientX: 100, clientY: 100 }))
    })
    act(() => {
      host.dispatchEvent(new MouseEvent('pointerleave'))
    })
    expect(orb.classList.contains('is-visible')).toBe(false)
    unmount()
    expect(orb.style.transform).toBe('')
  })
})


