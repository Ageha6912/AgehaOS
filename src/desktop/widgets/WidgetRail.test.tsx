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

  it('lists the two most recent notifications newest-first with no dead center entry', () => {
    const push = useNotificationStore.getState().push
    push({ appId: 'com.ageha.notes', title: '应用更新', body: '3 个应用可更新' })
    push({ appId: 'system', title: '系统提示', body: '壁纸已更新' })
    render(<WidgetRail />)

    const card = screen.getByTestId('widgets-notifications')
    expect(card.textContent).toContain('应用更新')
    expect(card.textContent).toContain('系统提示')
    // 恰 2 条 = 全部展示、无「其余」：「查看更多」不渲染（Shell 3.1 视觉评审
    // 打回修正——收纳入口只在 items.length > 2 时存在，防死链接）。
    expect(screen.queryByTestId('widgets-notifications-more')).toBeNull()

    // 清空在有通知时渲染且可点。
    fireEvent.click(screen.getByTestId('widgets-notifications-clear'))
    expect(useNotificationStore.getState().items).toHaveLength(0)
    // 空态 = §3 构图（Shell 3.1 F2）：notification.empty 原文案保留 + 居中
    // 半透明铃铛 + 指向中心的弱化链接（独立 testid）——不再孤零零一行字；
    // 「查看更多」与「清空」双双退出：无其余可看、无东西可清（视觉评审
    // 打回修正——死链接与无意义按钮不得出现在空态构图里）。
    const empty = screen.getByTestId('widgets-notifications')
    expect(empty.textContent).toContain('暂无通知')
    expect(screen.queryByTestId('widgets-notifications-more')).toBeNull()
    expect(screen.queryByTestId('widgets-notifications-clear')).toBeNull()
    expect(screen.getByTestId('widgets-notifications-empty-icon')).toBeInTheDocument()
    // 空态链接语义 = 「打开通知中心」（notification.center 现成键，i18n 零
    // 新增）：不借用「查看更多」——0 条通知无「更多」可言（第 3 轮视觉
    // 评审打回：暂无通知与查看更多同框即折叠语义自相矛盾）。
    expect(screen.getByTestId('widgets-notifications-empty-open').textContent).toBe('通知中心')
    expect(empty.textContent).not.toContain('查看更多')
    fireEvent.click(screen.getByTestId('widgets-notifications-empty-open'))
    expect(useNotificationStore.getState().panelOpen).toBe(true)
  })

  it('caps the recent list at two entries and drops the oldest（Shell 3.1 F2）', () => {
    const push = useNotificationStore.getState().push
    push({ appId: 'com.ageha.notes', title: '第一条', body: '最早' })
    push({ appId: 'system', title: '第二条', body: '次新' })
    push({ appId: 'com.ageha.terminal', title: '第三条', body: '最新' })
    render(<WidgetRail />)

    // 默认最多 2 条（原 3 条收档，F2「明显弱于 System」）：最新在前，
    // 更早的收进「查看更多」（通知中心）。
    const card = screen.getByTestId('widgets-notifications')
    const rows = card.querySelectorAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('第三条')
    expect(rows[1]!.textContent).toContain('第二条')
    expect(card.textContent).not.toContain('第一条')
    // 有「其余」被收进（3 > 2）→「查看更多」在位并进入通知中心
    // （panelOpen 槽，铃铛/左栏/此处三口共用）。
    fireEvent.click(screen.getByTestId('widgets-notifications-more'))
    expect(useNotificationStore.getState().panelOpen).toBe(true)
  })

  it('hides clear in the empty state（视觉评审打回修正：空态无东西可清）', () => {
    render(<WidgetRail />)

    // §3 减法：空态头部只剩 caption 标题，禁用态「清空」按钮不再挂在那里。
    expect(screen.queryByTestId('widgets-notifications-clear')).toBeNull()
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
      // 禁跨层借用 rail 的 shadow-float / 弹层的 shadow-popover（§6.2 规则 3）。
      expect(card.classList.contains('shadow-popover'), `no shadow-popover on ${testId}`).toBe(false)
      expect(card.classList.contains('shadow-float'), `no shadow-float on ${testId}`).toBe(false)
    }
    // Shell 3.1 F2 权重分级（brief §1「Notification 必须明显弱于 System」+
    // 任务书 §16）：Clock/System = 全档卡 shadow-panel；Notification/World =
    // quiet 档 shadow-soft（分卡断言为本轮契约目标的授权更新，非掩盖问题）。
    for (const testId of ['widgets-clock', 'widgets-system']) {
      const card = screen.getByTestId(testId)
      expect(card.classList.contains('shadow-panel'), `shadow-panel on ${testId}`).toBe(true)
      expect(card.classList.contains('shadow-soft'), `no shadow-soft on ${testId}`).toBe(false)
      expect(card.classList.contains('p-4'), `p-4 on ${testId}`).toBe(true)
    }
    for (const testId of ['widgets-notifications', 'widgets-world']) {
      const card = screen.getByTestId(testId)
      expect(card.classList.contains('shadow-soft'), `shadow-soft on ${testId}`).toBe(true)
      expect(card.classList.contains('shadow-panel'), `no shadow-panel on ${testId}`).toBe(false)
      expect(card.classList.contains('border'), `no border on quiet ${testId}`).toBe(false)
      expect(card.classList.contains('p-3'), `p-3 on ${testId}`).toBe(true)
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
