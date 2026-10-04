import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { consumeLauncherCategory, resetLauncherIntent } from '@/desktop/taskbar/launcher-intent'
import { resetAppStore } from '@/store/app-store'
import { resetDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { resetEclosionStore, useEclosionStore } from '@/store/eclosion-store'
import { resetLauncherStore } from '@/store/launcher-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetWindowStore } from '@/store/window-store'

import { WidgetRail } from './WidgetRail'

import type { EclosionWorldSummary } from '@/store/eclosion-store'

vi.mock('@/services/dynamic-desktop', () => ({
  systemDynamicDesktop: { refresh: vi.fn(async () => undefined) },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetNotificationStore()
  resetDynamicDesktopStore()
  resetEclosionStore()
  resetLauncherStore()
  resetLauncherIntent()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 最小合法世界摘要（store 直写不校验——校验在编排器；apps 一行即够）。 */
function worldSummary(overrides: Partial<EclosionWorldSummary> = {}): EclosionWorldSummary {
  return {
    worldDate: '2026-09-21',
    headline: '测试世界：边缘推理与本地智能体',
    paletteId: 'aurora-borealis',
    accentHue: 212,
    degraded: false,
    signalCount: 2,
    signals: { titles: ['信号一', '信号二'], sourceName: 'GitHub Trending', sourceUrl: 'https://example.com' },
    apps: [
      {
        slug: 'edge-oracle',
        name: '边缘神谕',
        hue: 268,
        tagline: '在你的浏览器里预言下一行代码',
        category: 'tools',
        window: { width: 720, height: 480 },
      },
    ],
    ...overrides,
  }
}

/** 开启羽化并写入世界摘要（STEP 4 第四层的前置状态）。 */
function seedWorld(overrides: Partial<EclosionWorldSummary> = {}): void {
  useEclosionStore.getState().setEnabled(true)
  useEclosionStore.getState().applyWorld(worldSummary(overrides))
}

describe('WidgetRail (STEP 4 Floating System Center)', () => {
  it('renders the floating layers: clock/time zone, system, notifications — brand banner retired', () => {
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-clock').textContent).toContain('10:30')
    // 假天气已退役（UI 评审 P1-4）：改显系统真实时区名。
    expect(screen.getByTestId('widgets-clock').textContent).not.toContain('°C')
    expect(screen.getByTestId('widgets-clock-timezone').textContent).not.toBe('')
    // 极简化（STEP 4）：壁纸缩略图（纯装饰图像）随 Dashboard 感一并退役。
    expect(screen.queryByTestId('widgets-clock-thumb')).toBeNull()
    expect(screen.getByTestId('widgets-system')).toBeInTheDocument()
    expect(screen.getByTestId('widgets-notifications')).toBeInTheDocument()
    // 品牌横幅退役（中央品牌层 + Workspace Panel 品牌区已承载）。
    expect(screen.queryByTestId('widgets-brand')).toBeNull()
  })

  it('hides the world card when eclosion is off (quiet desktop, same gate as STEP 3)', () => {
    render(<WidgetRail />)

    // 羽化默认关：第四层整卡不渲染（WorldSignals 同款门控，桌面保持安静）。
    expect(screen.queryByTestId('widgets-world')).toBeNull()
  })

  it('shows the world summary card when eclosion is on and routes to the launcher today category', () => {
    seedWorld()
    render(<WidgetRail />)

    const card = screen.getByTestId('widgets-world')
    expect(card.textContent).toContain('测试世界：边缘推理与本地智能体')
    expect(card.textContent).toContain('1 款新应用')
    expect(card.textContent).toContain('今日已更新')

    // 「查看世界」= 复用 STEP 3 launcher-intent 一次性意图 + 共享启动器。
    fireEvent.click(screen.getByTestId('widgets-world-entry'))
    expect(consumeLauncherCategory()).toBe('today')
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('marks a stale world honestly (cross-UTC-midnight summary)', () => {
    seedWorld({ worldDate: '2026-09-20' })
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-world').textContent).toContain('等待换新')
  })

  it('shows the quiet empty state (no dead entry) when eclosion is on but the world has not landed', () => {
    useEclosionStore.getState().setEnabled(true)
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-world-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('widgets-world-entry')).toBeNull()
  })

  it('folds the calendar into the clock card and highlights today (§32 收拢)', () => {
    render(<WidgetRail />)

    // 默认收起 = 参考图形态；展开后月历出现并高亮今日。
    expect(screen.queryByTestId('widgets-calendar')).toBeNull()
    fireEvent.click(screen.getByTestId('widgets-clock-calendar-toggle'))
    const calendar = screen.getByTestId('widgets-calendar')
    const today = calendar.querySelector('[data-today="true"]') as HTMLElement
    expect(today.textContent).toBe('21')
    expect(today.classList.contains('bg-primary')).toBe(true)
  })

  it('shows the three real system metric rows without inventing progress bars', () => {
    render(<WidgetRail />)

    // 指标源不可用时显「—」（jsdom 无 performance.memory / connection），
    // 且不画进度条（ratio null = 无真实读数不造假进度，§0.5）。帧率如实标
    // 「流畅度」，不再冒充 CPU。
    expect(screen.queryByTestId('widgets-system-cpu')).toBeNull()
    const fps = screen.getByTestId('widgets-system-fps')
    expect(fps.textContent).toContain('流畅度')
    expect(fps.textContent).toContain('—')
    expect(fps.getAttribute('title')).toContain('帧率')
    expect(fps.querySelector('div[aria-hidden="true"]')).toBeNull()
    expect(screen.getByTestId('widgets-system-memory').textContent).toContain('内存')
    expect(screen.getByTestId('widgets-system-network').textContent).toContain('网络')
  })

  it('lists the three most recent notifications newest-first, clears all, and offers the center', () => {
    const push = useNotificationStore.getState().push
    push({ appId: 'com.ageha.notes', title: '应用更新', body: '3 个应用可更新' })
    push({ appId: 'system', title: '系统提示', body: '壁纸已更新' })
    render(<WidgetRail />)

    const card = screen.getByTestId('widgets-notifications')
    expect(card.textContent).toContain('应用更新')
    expect(card.textContent).toContain('系统提示')

    // 「查看更多」进入通知中心：复用 panelOpen 槽（铃铛/左栏/此处三口共用）。
    fireEvent.click(screen.getByTestId('widgets-notifications-more'))
    expect(useNotificationStore.getState().panelOpen).toBe(true)

    fireEvent.click(screen.getByTestId('widgets-notifications-clear'))
    expect(useNotificationStore.getState().items).toHaveLength(0)
    // 空态保留整卡（真实空态文案），且不再渲染「查看更多」（进中心无内容可看）。
    expect(screen.getByTestId('widgets-notifications').textContent).toContain('暂无通知')
    expect(screen.queryByTestId('widgets-notifications-more')).toBeNull()
  })

  it('disables clear when there are no notifications', () => {
    render(<WidgetRail />)

    const clear = screen.getByTestId('widgets-notifications-clear')
    expect(clear).toBeDisabled()
    // 禁用态用 disabled 文字 token，不靠整体降透明度（玻璃上会糊成一片）。
    expect(clear.classList.contains('disabled:text-text-disabled')).toBe(true)
    expect(clear.classList.contains('disabled:opacity-40')).toBe(false)
  })

  it('floats as separate glass cards: container passes pointers through, cards take them (§31/§32)', () => {
    seedWorld()
    render(<WidgetRail />)

    const rail = screen.getByTestId('widget-rail')
    // 容器只占位不画材质：空隙处指针穿透回桌面（右键空白契约）。
    expect(rail.className).not.toContain('surface-glass')
    expect(rail.className).toContain('pointer-events-none')
    expect(rail.className).toContain('desktop-chrome')
    for (const testId of ['widgets-clock', 'widgets-system', 'widgets-notifications', 'widgets-world']) {
      const card = screen.getByTestId(testId)
      expect(card.className).toContain('surface-glass')
      expect(card.className).toContain('pointer-events-auto')
      expect(card.className).toContain('rounded-2xl')
      // 材质表②：subtle 档 shadow-panel（自 shadow-popover 降档）；禁跨层
      // 借用 rail 的 shadow-float / 弹层的 shadow-popover（§6.2 规则 3）。
      expect(card.classList.contains('shadow-panel'), `shadow-panel on ${testId}`).toBe(true)
      expect(card.classList.contains('shadow-popover'), `no shadow-popover on ${testId}`).toBe(false)
      expect(card.classList.contains('shadow-float'), `no shadow-float on ${testId}`).toBe(false)
    }
  })

  it('keeps the shell 2.0 floating rhythm and drops the full-height dashboard container (STEP 4)', () => {
    render(<WidgetRail />)

    const rail = screen.getByTestId('widget-rail')
    // right-5(20px) + gap-4(16px)：卡片间距节奏（§33.2 定案值）；top 锚 =
    // 菜单栏 32px + 16px = 48px（token 计算式，随地基 token 自动成立）。
    expect(rail.classList.contains('right-5')).toBe(true)
    expect(rail.classList.contains('gap-4')).toBe(true)
    expect(rail.classList.contains('top-[calc(var(--ag-menubar-height)+1rem)]')).toBe(true)
    // 卡宽 288px = token 296 - 8（简报 280-320 区间内，token 消费）。
    expect(rail.classList.contains('w-[calc(var(--ag-rail-right-width)-0.5rem)]')).toBe(true)
    // 高度由内容决定（STEP 4 验收「不得贯穿整个高度」）：bottom 锚退役，
    // 仅保留「顶锚 48 + 底部 Dock 区 88」剩余空间内的兜底滚动。
    expect(rail.classList.contains('bottom-3')).toBe(false)
    expect(rail.className).toContain(
      'max-h-[calc(100vh-var(--ag-menubar-height)-1rem-var(--ag-dock-height)-var(--ag-dock-gap))]',
    )
    // 容器无独立玻璃底：观感 = 桌面上独立漂浮面板，非连续 Dashboard 侧栏。
    expect(rail.classList.contains('surface-glass')).toBe(false)
    expect(rail.classList.contains('widget-card')).toBe(false)
  })
})
