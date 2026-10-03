import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { registerRuntimeApp, resetAppStore } from '@/store/app-store'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { TodayRail } from './TodayRail'

/**
 * 「今日应用」专用列（2026-10-03 用户裁决：左栏往右再加一栏，整列放「今日」
 * 分类的应用）。契约：世界就绪（羽化开 + world 摘要）才渲染；瓷贴与启动器
 * 「今日」分类同一数据源（世界行 hue 着色）；点击走 launchApp 按需生成路径。
 */

const WORLD_APPS = [
  { slug: 'edge-oracle', name: '边缘神谕', hue: 268, tagline: '一句话', category: 'tools', window: { width: 720, height: 480 } },
  { slug: 'signal-weaver', name: '信号织机', hue: 190, tagline: '一句话', category: 'tools', window: { width: 720, height: 480 } },
] as const

const seedWorld = (): void => {
  useEclosionStore.getState().applyWorld({
    worldDate: new Date().toISOString().slice(0, 10),
    headline: '本地智能体与边缘推理的清晨',
    paletteId: 'nebula-violet',
    accentHue: 212,
    degraded: false,
    signalCount: 2,
    signals: { titles: ['信号甲'], sourceName: 'GitHub Trending', sourceUrl: '' },
    apps: WORLD_APPS,
  })
}

const registerRuntime = (slug: string, name: string): void => {
  const result = registerRuntimeApp({
    id: `com.ageha.eclosion.${slug}`,
    name,
    version: '1.0.0',
    entry: '/apps/runtime/eclosion.html',
    permissions: [],
    window: { width: 720, height: 480, resizable: true },
  })
  expect(result.ok).toBe(true)
}

describe('TodayRail（今日应用列）', () => {
  beforeEach(() => {
    resetEclosionStore()
    resetWindowStore()
    resetAppStore()
  })

  it('羽化关 / 世界未就绪 → 整列不渲染；就绪后出现（拒绝装饰性空栏）', () => {
    seedEclosionForTests('u-rail', false)
    seedWorld()
    const view = render(<TodayRail />)
    expect(view.queryByTestId('today-rail')).toBeNull()

    // 开关开 → 列出现；世界清空 → 列消失。
    act(() => seedEclosionForTests('u-rail', true))
    expect(view.getByTestId('today-rail')).toBeInTheDocument()
    act(() => {
      resetEclosionStore()
      seedEclosionForTests('u-rail', true)
    })
    expect(view.queryByTestId('today-rail')).toBeNull()
  })

  it('世界就绪 → 每个今日应用一枚瓷贴（可达名 = 应用名，顺序随世界清单）', () => {
    seedEclosionForTests('u-rail', true)
    seedWorld()
    render(<TodayRail />)

    expect(screen.getByTestId('today-rail').getAttribute('aria-label')).toBe('今日应用')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['边缘神谕', '信号织机'])
    expect(screen.getByTestId('today-rail-app-edge-oracle')).toBeInTheDocument()
    expect(screen.getByTestId('today-rail-app-signal-weaver')).toBeInTheDocument()
  })

  it('无缝相连契约：贴左栏右缘、无左边框与左侧圆角、无 overflow（tooltip 不被裁）', () => {
    seedEclosionForTests('u-rail', true)
    seedWorld()
    render(<TodayRail />)

    const nav = screen.getByTestId('today-rail')
    // 左缘 = 左栏右缘（left-4 16px + 栏宽 72px = 88px = token 80 + 0.5rem；
    // Playwright 实测钉扎：0.5rem = 8px，右缘是 88 不是 92）。
    expect(nav.className).toContain('left-[calc(var(--ag-rail-left-width)+0.5rem)]')
    // 中缝 = 左栏自己的右框线：本栏无左边框、左侧方角。
    expect(nav.className).toContain('rounded-r-xl')
    expect(nav.className).not.toContain('rounded-l')
    expect(nav.className).not.toContain('border-l')
    // overflow 会把向右伸出的 tooltip 一并裁掉（2026-10-03 实测）——禁止。
    expect(nav.className).not.toContain('overflow')
  })

  it('点击瓷贴走 launchApp 按需生成路径（kind=today 的窗口打开）', () => {
    seedEclosionForTests('u-rail', true)
    seedWorld()
    registerRuntime('edge-oracle', '边缘神谕')
    render(<TodayRail />)

    fireEvent.click(screen.getByTestId('today-rail-app-edge-oracle'))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.eclosion.edge-oracle')
  })
})
