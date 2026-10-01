import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFieldPlan, buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
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
  // §32 场层双门控（计划 + 开关）：本文件测场渲染契约，统一开启。
  useDynamicDesktopStore.setState({
    prefs: { ...useDynamicDesktopStore.getState().prefs, enabled: true },
  })
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

  it('never shows the AI badge (2026-09-27 裁决：生成式壁纸不显示徽标)', () => {
    useDynamicDesktopStore.setState({ currentPlan: PLAN_A })
    render(<WallpaperLayer />)
    expect(screen.queryByTestId('ai-badge')).toBeNull()

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

describe('WallpaperLayer gradient-field surfaces (2026-09-27 生成域)', () => {
  function fieldPlan(seed: string, fieldId: string): WallpaperPlan {
    return buildFieldPlan({
      seed,
      fieldId,
      zone: 'converge',
      reason: { signals: ['theme:light'], palette: fieldId, motif: 'gradient-field' },
    })
  }

  it('renders a gradient-field plan with the canvas or css fallback surface (§32 照片基底之上)', () => {
    // jsdom 无 2d context → 走 CSS 回退分支；canvas 分支由浏览器烟雾覆盖。
    useDynamicDesktopStore.setState({ currentPlan: fieldPlan('p1', 'dawn-white') })
    const { container } = render(<WallpaperLayer />)

    const canvas = container.querySelector('[data-testid="wallpaper-surface-canvas"]')
    const css = container.querySelector('[data-testid="wallpaper-surface-css"]')
    expect(canvas !== null || css !== null).toBe(true)
    // §32：照片基底常驻（出厂默认壁纸），场计划覆盖其上。
    expect(container.querySelector('[data-testid="wallpaper-surface-photo"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wallpaper-surface-photo-fallback"]')).toBeNull()
  })

  it('keeps the photo base mounted full-bleed with the shipped asset (§32 修订 6)', () => {
    const { container } = render(<WallpaperLayer />)
    const photo = container.querySelector<HTMLElement>('[data-testid="wallpaper-surface-photo"]')
    expect(photo).not.toBeNull()
    // 满屏 cover 单层（新原片不适用缩小方案），居中等比铺满。
    expect(photo?.style.backgroundImage).toContain('/wallpapers/ageha-dreamland.jpg?v=4')
    expect(photo?.className).toContain('bg-cover')
    expect(photo?.className).toContain('inset-0')
  })

  it('keeps the surface mounted across plan transitions of the same style', () => {
    useDynamicDesktopStore.setState({ currentPlan: fieldPlan('p1', 'dawn-white') })
    const { container } = render(<WallpaperLayer />)

    act(() => useDynamicDesktopStore.setState({ currentPlan: fieldPlan('p2', 'night-veil') }))
    act(() => vi.advanceTimersByTime(700))

    expect(
      container.querySelector(
        '[data-testid="wallpaper-surface-canvas"], [data-testid="wallpaper-surface-css"]',
      ),
    ).not.toBeNull()
    expect(useDynamicDesktopStore.getState().currentPlan?.fieldId).toBe('night-veil')
  })
})
