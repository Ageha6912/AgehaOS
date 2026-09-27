import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import {
  POPOVER_EXIT_MS,
  popoverMotionClass,
  prefersReducedMotion,
  toastMotionClass,
  useExitPhase,
} from './pop-motion'

function Harness({ open }: { open: boolean }) {
  const phase = useExitPhase(open)
  if (!phase.render) return null
  return (
    <div
      data-testid="surface"
      data-exiting={phase.exiting ? 'true' : 'false'}
      className={popoverMotionClass(phase.exiting)}
    />
  )
}

function ToggleHarness() {
  const [open, setOpen] = useState(true)
  const phase = useExitPhase(open)
  return (
    <>
      <button type="button" data-testid="toggle" onClick={() => setOpen((value) => !value)}>
        toggle
      </button>
      {phase.render && <div data-testid="surface" data-exiting={String(phase.exiting)} />}
    </>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (Element.prototype as unknown as { animate?: unknown }).animate
})

/** 让 hasMotionRuntime() 为真：测退场停留（jsdom 默认无 WAAPI → 即时卸载语义）。 */
function installWAAPI(): void {
  ;(Element.prototype as unknown as { animate?: unknown }).animate = vi.fn(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    reverse: vi.fn(),
  }))
}

describe('弹层动效原语（DESIGN.md §14）', () => {
  it('archives to the product tiers: 120ms exit, close never longer than open', () => {
    expect(POPOVER_EXIT_MS).toBe(120)
  })

  it('detects prefers-reduced-motion live', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    expect(prefersReducedMotion()).toBe(true)
  })

  it('unmounts instantly without a motion runtime (jsdom/legacy degradation)', () => {
    // 不 stub animate：jsdom 默认无 WAAPI → 关闭即卸载，无退场停留
    const { rerender } = render(<Harness open />)
    rerender(<Harness open={false} />)
    expect(screen.queryByTestId('surface')).toBeNull()
  })

  it('keeps the node mounted through the exit, then unmounts (WAAPI present)', () => {
    installWAAPI()
    const { rerender } = render(<Harness open />)
    expect(screen.getByTestId('surface').getAttribute('data-exiting')).toBe('false')

    rerender(<Harness open={false} />)
    expect(screen.getByTestId('surface').getAttribute('data-exiting')).toBe('true')
    expect(screen.getByTestId('surface').className).toContain('opacity-0')
    expect(screen.getByTestId('surface').className).toContain('-translate-y-1')

    act(() => {
      vi.advanceTimersByTime(POPOVER_EXIT_MS)
    })
    expect(screen.queryByTestId('surface')).toBeNull()
  })

  it('cancels the exit when reopened mid-flight (interruptible, current-value resume)', () => {
    installWAAPI()
    render(<ToggleHarness />)
    act(() => {
      screen.getByTestId('toggle').click()
    })
    // 退场中途重新打开：节点不卸载、退场态清除
    act(() => {
      vi.advanceTimersByTime(60)
    })
    act(() => {
      screen.getByTestId('toggle').click()
    })
    expect(screen.getByTestId('surface').getAttribute('data-exiting')).toBe('false')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByTestId('surface')).toBeInTheDocument()
  })

  it('exits instantly under prefers-reduced-motion (degraded switch)', () => {
    installWAAPI()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    render(<ToggleHarness />)
    act(() => {
      screen.getByTestId('toggle').click()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('surface')).toBeNull()
  })

  it('exposes the toast variant sliding on the X axis', () => {
    expect(toastMotionClass(false)).toContain('animate-os-toast-in')
    expect(toastMotionClass(false)).toContain('translate-x-0')
    expect(toastMotionClass(true)).toContain('opacity-0 translate-x-6')
    expect(popoverMotionClass(true)).toContain('-translate-y-1')
  })
})
