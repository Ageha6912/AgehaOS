import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
import type { WallpaperPlan } from '@/core/dynamic/types'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

import { WallpaperLayer } from './WallpaperLayer'

function planOf(seed: string, paletteId: string): WallpaperPlan {
  return buildWallpaperPlan({
    seed,
    style: 'fluid-gradient',
    paletteId,
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    zone: 'converge',
    reason: { signals: ['time:day'], palette: paletteId, motif: 'fluid-gradient' },
  })
}

const PLAN_A = planOf('plan-a', 'midnight-ink')
const PLAN_B = planOf('plan-b', 'nebula-violet')
const PLAN_C = planOf('plan-c', 'deep-ocean')

beforeEach(() => {
  vi.useFakeTimers()
  resetDynamicDesktopStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WallpaperLayer (§4.5，验收 ⑧)', () => {
  // jsdom 会把内联样式中的 hex 规范化为 rgb() 形式。
  const RGB = {
    midnightDeep: 'rgb(29, 33, 51)', // #1d2133 midnight-ink 最深 stop
    nebulaDeep: 'rgb(59, 29, 110)', // #3b1d6e nebula-violet 最深 stop
    oceanDeep: 'rgb(18, 33, 46)', // #12212e deep-ocean 中间 stop
  }

  it('renders the current plan through the CSS fallback surface when canvas is unavailable', () => {
    useDynamicDesktopStore.setState({ currentPlan: PLAN_A })
    render(<WallpaperLayer />)

    const surface = screen.getByTestId('wallpaper-surface-css')
    expect(surface.style.background).toContain(RGB.midnightDeep)
    expect(screen.queryByTestId('wallpaper-layer-incoming')).toBeNull()
  })

  it('cross-fades a new plan: mount at opacity 0 → fade to 1 → commit to the front layer', () => {
    useDynamicDesktopStore.setState({ currentPlan: PLAN_A })
    render(<WallpaperLayer />)

    act(() => useDynamicDesktopStore.setState({ currentPlan: PLAN_B }))

    const incoming = screen.getByTestId('wallpaper-layer-incoming')
    expect(incoming.style.opacity).toBe('0')
    expect(within(incoming).getByTestId('wallpaper-surface-css').style.background).toContain(RGB.nebulaDeep)

    act(() => vi.advanceTimersByTime(20))
    expect(screen.getByTestId('wallpaper-layer-incoming').style.opacity).toBe('1')

    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByTestId('wallpaper-layer-incoming')).toBeNull()
    // 前层已提交为新计划
    expect(screen.getByTestId('wallpaper-surface-css').style.background).toContain(RGB.nebulaDeep)
  })

  it('converges on the latest target when interrupted mid-fade (不回弹、不排队)', () => {
    useDynamicDesktopStore.setState({ currentPlan: PLAN_A })
    render(<WallpaperLayer />)

    act(() => useDynamicDesktopStore.setState({ currentPlan: PLAN_B }))
    act(() => vi.advanceTimersByTime(20))

    // 过渡进行中再次触发生成：目标直接替换为 C
    act(() => useDynamicDesktopStore.setState({ currentPlan: PLAN_C }))
    const incoming = screen.getByTestId('wallpaper-layer-incoming')
    expect(within(incoming).getByTestId('wallpaper-surface-css').style.background).toContain(RGB.oceanDeep)

    act(() => vi.advanceTimersByTime(700))
    expect(screen.queryByTestId('wallpaper-layer-incoming')).toBeNull()
    // 最终收敛到 C，而不是先经过 B
    expect(screen.getByTestId('wallpaper-surface-css').style.background).toContain(RGB.oceanDeep)
    expect(screen.getByTestId('wallpaper-surface-css').style.background).not.toContain(RGB.nebulaDeep)
  })

  it('shows the AI badge while unpinned and hides it when pinned (铁律 1/4)', () => {
    useDynamicDesktopStore.setState({ currentPlan: PLAN_A })
    render(<WallpaperLayer />)
    expect(screen.getByTestId('ai-badge')).toBeInTheDocument()

    act(() => {
      resetDynamicDesktopStore()
      useDynamicDesktopStore.setState({
        currentPlan: PLAN_A,
        prefs: { enabled: true, randomness: 40, hideBadge: false, pinned: PLAN_A, blockedStyles: [], llmEnhance: false },
      })
    })
    expect(screen.queryByTestId('ai-badge')).toBeNull()
  })

  it('hides the badge when the user opts out (§6.5)', () => {
    useDynamicDesktopStore.setState({
      currentPlan: PLAN_A,
      prefs: { enabled: true, randomness: 40, hideBadge: true, pinned: null, blockedStyles: [], llmEnhance: false },
    })
    render(<WallpaperLayer />)
    expect(screen.queryByTestId('ai-badge')).toBeNull()
  })
})
