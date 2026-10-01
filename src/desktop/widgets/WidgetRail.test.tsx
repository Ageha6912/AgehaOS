import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import {
  resetDynamicDesktopStore,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { systemDynamicDesktop } from '@/services/dynamic-desktop'

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
  vi.mocked(systemDynamicDesktop.refresh).mockClear()
})

describe('WidgetRail', () => {
  it('renders the four real-data cards (§27)', () => {
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-clock').textContent).toContain('10:30')
    expect(screen.getByTestId('widgets-calendar')).toBeInTheDocument()
    expect(screen.getByTestId('widgets-system')).toBeInTheDocument()
    expect(screen.getByTestId('widgets-wallpaper')).toBeInTheDocument()
  })

  it('highlights today in the calendar and labels the month', () => {
    render(<WidgetRail />)

    const calendar = screen.getByTestId('widgets-calendar')
    expect(calendar.getAttribute('aria-label')).toContain('2026')
    const today = calendar.querySelector('[data-today="true"]') as HTMLElement
    expect(today.textContent).toBe('21')
    expect(today.classList.contains('bg-primary')).toBe(true)
  })

  it('shows live system rows (version, locale, tier, windows, unread)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useNotificationStore.getState().push({ appId: 'system', titleKey: 'boot.progress' })
    render(<WidgetRail />)

    const system = screen.getByTestId('widgets-system')
    expect(system.textContent).toContain('v0.')
    expect(system.textContent).toContain('zh-CN')
    expect(system.textContent).toContain('L0')
    expect(system.textContent).toContain('1')
  })

  it('wallpaper card shows the composition name and renews on demand', () => {
    useDynamicDesktopStore.setState({
      currentPlan: {
        // 最小可行计划：壁纸卡只消费 fieldId。
        fieldId: 'dawn-white',
      } as never,
      prefs: {
        enabled: true,
        randomness: 40,
        hideBadge: false,
        pinned: null,
        blockedStyles: [],
        llmEnhance: false,
      },
    })
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-wallpaper').textContent).toContain('晨白')
    fireEvent.click(screen.getByTestId('widgets-wallpaper-renew'))
    expect(systemDynamicDesktop.refresh).toHaveBeenCalledTimes(1)
  })

  it('wallpaper card shows the off note when the dynamic desktop is disabled', () => {
    useDynamicDesktopStore.setState({ prefs: {
      enabled: false,
      randomness: 40,
      hideBadge: false,
      pinned: null,
      blockedStyles: [],
      llmEnhance: false,
    } })
    render(<WidgetRail />)

    expect(screen.getByTestId('widgets-wallpaper').textContent).toContain('壁纸已关闭')
    expect(screen.queryByTestId('widgets-wallpaper-renew')).not.toBeInTheDocument()
  })

  it('floats as separate glass cards: container passes pointers through, cards take them (§31)', () => {
    render(<WidgetRail />)

    const rail = screen.getByTestId('widget-rail')
    // 容器只占位不画材质：空隙处指针穿透回桌面（右键空白契约）。
    expect(rail.className).not.toContain('surface-glass')
    expect(rail.className).toContain('pointer-events-none')
    for (const testId of ['widgets-clock', 'widgets-calendar', 'widgets-system', 'widgets-wallpaper']) {
      const card = screen.getByTestId(testId)
      expect(card.className).toContain('surface-glass')
      expect(card.className).toContain('pointer-events-auto')
      expect(card.className).toContain('rounded-xl')
      expect(card.className).toContain('shadow-popover')
    }
  })
})
