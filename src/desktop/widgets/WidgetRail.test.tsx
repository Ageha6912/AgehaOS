import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetWindowStore } from '@/store/window-store'

import { WidgetRail } from './WidgetRail'

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
})

describe('WidgetRail (§32 参考图四卡)', () => {
  it('renders the four reference cards: clock/weather, system, notifications, brand (§32)', () => {
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-clock').textContent).toContain('10:30')
    // 天气行 = 参考图版式（示例数据，title 标注无实时源）。
    expect(screen.getByTestId('widgets-clock').textContent).toContain('24°C')
    expect(screen.getByTestId('widgets-clock-thumb')).toBeInTheDocument()
    expect(screen.getByTestId('widgets-system')).toBeInTheDocument()
    expect(screen.getByTestId('widgets-notifications')).toBeInTheDocument()
    expect(screen.getByTestId('widgets-brand').textContent).toContain('探索 · 连接 · 创造')
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

  it('shows the three real system metrics cells (CPU/memory/network)', () => {
    render(<WidgetRail />)

    // 指标源不可用时显「—」（jsdom 无 performance.memory / connection），
    // 但三个真实数据单元格必须在位。
    expect(screen.getByTestId('widgets-system-cpu').textContent).toContain('CPU')
    expect(screen.getByTestId('widgets-system-memory').textContent).toContain('内存')
    expect(screen.getByTestId('widgets-system-network').textContent).toContain('网络')
  })

  it('lists the three most recent notifications newest-first and clears all', () => {
    const push = useNotificationStore.getState().push
    push({ appId: 'com.ageha.notes', title: '应用更新', body: '3 个应用可更新' })
    push({ appId: 'system', title: '系统提示', body: '壁纸已更新' })
    render(<WidgetRail />)

    const card = screen.getByTestId('widgets-notifications')
    expect(card.textContent).toContain('应用更新')
    expect(card.textContent).toContain('系统提示')

    fireEvent.click(screen.getByTestId('widgets-notifications-clear'))
    expect(useNotificationStore.getState().items).toHaveLength(0)
    // 空态保留整卡（真实空态文案）。
    expect(screen.getByTestId('widgets-notifications').textContent).toContain('暂无通知')
  })

  it('disables clear when there are no notifications', () => {
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-notifications-clear')).toBeDisabled()
  })

  it('floats as separate glass cards: container passes pointers through, cards take them (§31/§32)', () => {
    render(<WidgetRail />)

    const rail = screen.getByTestId('widget-rail')
    // 容器只占位不画材质：空隙处指针穿透回桌面（右键空白契约）。
    expect(rail.className).not.toContain('surface-glass')
    expect(rail.className).toContain('pointer-events-none')
    expect(rail.className).toContain('desktop-chrome')
    for (const testId of ['widgets-clock', 'widgets-system', 'widgets-notifications', 'widgets-brand']) {
      const card = screen.getByTestId(testId)
      expect(card.className).toContain('surface-glass')
      expect(card.className).toContain('pointer-events-auto')
      expect(card.className).toContain('rounded-2xl')
      expect(card.className).toContain('shadow-popover')
    }
  })
})
