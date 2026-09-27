import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'

import { GLOW_SIZE_PX, useCursorGlow } from './use-cursor-glow'
import { useClickRipple } from './use-click-ripple'
import { PARALLAX_MAX_PX, PARALLAX_SCALE, useWallpaperParallax } from './use-wallpaper-parallax'

/**
 * rAF/几何手动驱动测试台（与 boot-motion 同一手法的桌面增强版）：
 * fake timers 接管 rAF（16ms 帧距），rect 用 mock 注入。
 */

function ParallaxHarness({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLImageElement | null>(null)
  useWallpaperParallax(ref, enabled)
  return <img ref={ref} data-testid="photo" alt="" />
}

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

function RippleHarness() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useClickRipple(hostRef)
  return <div ref={hostRef} data-testid="ripple-host" style={{ width: 800, height: 600 }} />
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

const pointerMove = (x: number, y: number) =>
  new MouseEvent('pointermove', { clientX: x, clientY: y } as MouseEventInit)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useWallpaperParallax（壁纸视差，DESIGN.md §15）', () => {
  it('lerps the photo toward the pointer with scale masking and translate', () => {
    const { getByTestId } = render(<ParallaxHarness enabled />)
    const photo = getByTestId('photo')
    expect(photo.style.transform).toBe('') // 启用未动：恒等

    window.innerWidth = 1280
    window.innerHeight = 720
    act(() => {
      window.dispatchEvent(pointerMove(1280, 720)) // 归一化 (1,1)
    })
    act(() => {
      vi.advanceTimersByTime(3000) // 足够多帧收敛
    })
    // dir=-1：位移朝指针反方向；scale 掩边
    expect(photo.style.transform).toBe(
      `translate3d(${(-PARALLAX_MAX_PX).toFixed(2)}px, ${(-PARALLAX_MAX_PX * 0.55).toFixed(2)}px, 0) scale(${PARALLAX_SCALE})`,
    )
  })

  it('stops scheduling frames once converged (converge-stop)', () => {
    render(<ParallaxHarness enabled />)
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    act(() => {
      window.dispatchEvent(pointerMove(1280, 720))
      vi.advanceTimersByTime(3000) // 收敛
    })
    rafSpy.mockClear()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('converges back to identity after the pointer leaves the viewport', () => {
    const { getByTestId } = render(<ParallaxHarness enabled />)
    act(() => {
      window.dispatchEvent(pointerMove(1280, 720))
      vi.advanceTimersByTime(3000)
    })
    act(() => {
      document.documentElement.dispatchEvent(new Event('pointerleave'))
      vi.advanceTimersByTime(3000)
    })
    expect(getByTestId('photo').style.transform).toContain('translate3d(0.00px, 0.00px')
  })

  it('does nothing when disabled or under reduced motion', () => {
    const { getByTestId, rerender } = render(<ParallaxHarness enabled={false} />)
    act(() => {
      window.dispatchEvent(pointerMove(1280, 720))
      vi.advanceTimersByTime(500)
    })
    expect(getByTestId('photo').style.transform).toBe('')

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    rerender(<ParallaxHarness enabled />)
    act(() => {
      window.dispatchEvent(pointerMove(1280, 720))
      vi.advanceTimersByTime(500)
    })
    expect(getByTestId('photo').style.transform).toBe('')
  })
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

describe('useClickRipple（点击涟漪，DESIGN.md §15）', () => {
  it('spawns a ripple only on the empty host and cleans it up', () => {
    const { getByTestId } = render(<RippleHarness />)
    const host = getByTestId('ripple-host')

    act(() => {
      host.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, clientY: 200, bubbles: true }))
    })
    const ripple = host.querySelector('.os-ripple') as HTMLElement | null
    expect(ripple).not.toBeNull()
    expect(ripple?.style.getPropertyValue('--cr-x')).toBe('300.0px')

    // 兜底清理（300ms + 200ms 余量）
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(host.querySelector('.os-ripple')).toBeNull()
  })

  it('does not spawn when the pointer lands on a child element', () => {
    const { getByTestId } = render(
      <div data-testid="ripple-host-wrap">
        <RippleHarnessHost />
      </div>,
    )
    const wrap = getByTestId('ripple-host-wrap')
    const child = wrap.querySelector('[data-testid="ripple-child"]')!
    act(() => {
      child.dispatchEvent(new MouseEvent('pointerdown', { bubbles: false }))
    })
    void child
    expect(wrap.querySelector('.os-ripple')).toBeNull()
  })

  it('is inert under reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const { getByTestId } = render(<RippleHarness />)
    const host = getByTestId('ripple-host')
    act(() => {
      host.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }))
    })
    expect(host.querySelector('.os-ripple')).toBeNull()
  })
})

function RippleHarnessHost() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useClickRipple(hostRef)
  return (
    <div ref={hostRef} data-testid="ripple-host">
      <button type="button" data-testid="ripple-child">
        child
      </button>
    </div>
  )
}
