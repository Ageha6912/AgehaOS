import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BRAND_LOGO_FULL_SRC } from '@/components/brand-logo'
import { useBootStore } from '@/store/boot-store'
import { resetSessionStore, seedSessionForTests, useSessionStore } from '@/store/session-store'

import { BootScreen } from './BootScreen'

const TEST_USER = {
  id: 'u-1',
  username: 'alice',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
}

/**
 * fake timers 默认连 requestAnimationFrame 一起接管（16ms 一帧、时间戳=虚拟时钟），
 * 因此 advanceTimersByTime 能确定性驱动引擎的 rAF 循环（HANDOFF 坑 10：勿混 RTL waitFor）。
 */
beforeEach(() => {
  vi.useFakeTimers()
  useBootStore.setState(useBootStore.getInitialState())
})

afterEach(() => {
  vi.useRealTimers()
  resetSessionStore()
})

describe('BootScreen（motion-lab boot 引擎驱动，DESIGN.md §11）', () => {
  it('renders the dark reveal layer with the full brand logo and progress bar', () => {
    const { container } = render(<BootScreen />)

    const layer = screen.getByTestId('boot-screen')
    expect(layer).toHaveClass('boot-motion-screen')
    // 开机位用含字标全尺寸资产（DESIGN.md §10 双资产分工）；装饰性 img 不进可达树。
    expect(container.querySelector('img')).toHaveAttribute('src', BRAND_LOGO_FULL_SRC)

    const bar = screen.getByRole('progressbar', { name: '启动进度' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByRole('status')).toHaveTextContent('正在启动 AgehaOS…')
  })

  it('switches the status copy once progress crosses the first segment', () => {
    render(<BootScreen />)

    act(() => {
      vi.advanceTimersByTime(800)
    })
    // 800ms 时进度已越过 36%（第一段「固件自检」），状态文案切到加载。
    expect(useBootStore.getState().phase).toBe('loading')
    expect(screen.getByRole('status')).toHaveTextContent('正在加载系统资源…')
    const percent = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
    expect(percent).toBeGreaterThanOrEqual(36)
    expect(percent).toBeLessThan(55)
  })

  it('lands on the desktop when a session exists and completes the exit', () => {
    seedSessionForTests(TEST_USER)
    render(<BootScreen />)

    act(() => {
      vi.advanceTimersByTime(2400)
    })
    // 2.2s 引擎已完成（finishBoot → ready），退场进行中（收尾点 ~2.77s）。
    expect(useBootStore.getState().phase).toBe('ready')
    expect(screen.getByTestId('boot-screen')).toHaveAttribute('data-boot', 'complete')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByTestId('boot-screen')).toHaveClass('is-exiting')
    expect(screen.getByTestId('boot-screen').hidden).toBe(false)

    act(() => {
      vi.advanceTimersByTime(700)
    })
    // 退场收尾：引擎置 hidden，App 据此卸载覆盖层。
    expect(screen.getByTestId('boot-screen').hidden).toBe(true)
    expect(useBootStore.getState().layerExitDone).toBe(true)
  })

  it('lands on the login screen without a session', () => {
    resetSessionStore()
    render(<BootScreen />)

    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(useBootStore.getState().phase).toBe('login')
    expect(screen.getByRole('status')).toHaveTextContent('请登录以继续')
  })

  it('skips to completion via any key press', () => {
    resetSessionStore()
    render(<BootScreen />)

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })

    expect(useBootStore.getState().phase).toBe('login')
    expect(screen.getByTestId('boot-screen')).toHaveAttribute('data-boot', 'complete')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('skips to completion via a pointer press on the layer', () => {
    seedSessionForTests(TEST_USER)
    render(<BootScreen />)

    act(() => {
      fireEvent.pointerDown(screen.getByTestId('boot-screen'))
    })

    expect(useBootStore.getState().phase).toBe('ready')
    expect(screen.getByTestId('boot-screen')).toHaveAttribute('data-boot', 'complete')
  })

  it('reports the ready phase without starting the boot engine', () => {
    useBootStore.getState().setPhase('ready')

    render(<BootScreen />)

    expect(screen.getByRole('status')).toHaveTextContent('启动完成')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the session store untouched during boot rendering', () => {
    seedSessionForTests(TEST_USER)
    render(<BootScreen />)

    expect(useSessionStore.getState().status).toBe('authenticated')
  })
})
