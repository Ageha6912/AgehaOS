import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { buildWallpaperPlan, COMPOSITIONS } from '@/core/dynamic/generative/templates'
import {
  DYNAMIC_DESKTOP_KEY_PREFIX,
  resetDynamicDesktopStore,
  seedDynamicDesktopForTests,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'

import { SettingsApp } from './SettingsApp'

function historyEntry(seed: string) {
  return {
    plan: buildWallpaperPlan({
      seed,
      style: 'geometric' as const,
      paletteId: 'slate-night',
      compositionId: COMPOSITIONS[0].id,
      density: 0.1,
      zone: 'converge' as const,
      reason: { signals: [], palette: 'slate-night', motif: 'geometric' as const },
    }),
    level: 'L0' as const,
    createdAt: '2026-09-22T10:00:00.000Z',
  }
}

beforeEach(() => {
  resetAppStore()
  resetDynamicDesktopStore()
  seedDynamicDesktopForTests('u1')
  useDynamicDesktopStore.getState().hydrateForUser('u1')
})

function openDynamicSection() {
  fireEvent.click(screen.getByRole('button', { name: '动态桌面' }))
}

describe('SettingsApp 动态桌面 section', () => {
  it('starts with the master switch off (§32 照片基底出厂默认)', () => {
    render(<SettingsApp />)
    openDynamicSection()

    expect(screen.getByTestId('dynamic-desktop-toggle')).toHaveAttribute('aria-checked', 'false')
  })

  it('enabling the switch generates a wallpaper through the real pipeline', async () => {
    // §32 出厂默认关：点击开关即「开启 → 走真实生成管线」。
    render(<SettingsApp />)
    openDynamicSection()

    fireEvent.click(screen.getByTestId('dynamic-desktop-toggle'))
    expect(useDynamicDesktopStore.getState().prefs.enabled).toBe(true)

    await waitFor(() => expect(useDynamicDesktopStore.getState().currentPlan).not.toBeNull())
    expect(screen.getByText(/来源层级/)).toBeInTheDocument()
    expect(screen.getByText(/决策来源/)).toBeInTheDocument()
    expect(screen.getByText(/本地规则/)).toBeInTheDocument()
  })

  it('maps the slider onto the five bands and persists the value', () => {
    render(<SettingsApp />)
    openDynamicSection()

    const slider = screen.getByLabelText(/随机度/)
    expect(slider).toHaveValue('40')

    fireEvent.change(slider, { target: { value: '80' } })
    expect(useDynamicDesktopStore.getState().prefs.randomness).toBe(80)
    expect(screen.getByText(/· 探索/)).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '0' } })
    expect(screen.getByText(/· 固定/)).toBeInTheDocument()
  })

  it('pins and unpins the current wallpaper (铁律 1)', async () => {
    useDynamicDesktopStore.setState({ currentPlan: historyEntry('p1').plan })
    render(<SettingsApp />)
    openDynamicSection()

    const pin = screen.getByTestId('dynamic-desktop-pin')
    fireEvent.click(pin)
    expect(useDynamicDesktopStore.getState().prefs.pinned?.seed).toBe('p1')
    expect(screen.getByTestId('dynamic-desktop-unpin')).toBeInTheDocument()
    expect(screen.getByText(/已固定/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('dynamic-desktop-unpin'))
    expect(useDynamicDesktopStore.getState().prefs.pinned).toBeNull()
  })

  it('blocks the current style', () => {
    useDynamicDesktopStore.setState({ currentPlan: historyEntry('p1').plan })
    render(<SettingsApp />)
    openDynamicSection()

    fireEvent.click(screen.getByTestId('dynamic-desktop-block'))
    expect(useDynamicDesktopStore.getState().prefs.blockedStyles).toEqual(['geometric'])
  })

  it('lists history entries and rolls back to a pinned state (§6.5)', () => {
    useDynamicDesktopStore.setState({ history: [historyEntry('old-1'), historyEntry('old-2')] })
    render(<SettingsApp />)
    openDynamicSection()

    const list = screen.getByTestId('dynamic-desktop-history')
    expect(within(list).getAllByRole('button', { name: '回滚并固定' })).toHaveLength(2)

    fireEvent.click(within(list).getAllByRole('button', { name: '回滚并固定' })[0])
    const state = useDynamicDesktopStore.getState()
    expect(state.currentPlan?.seed).toBe('old-1')
    expect(state.prefs.pinned?.seed).toBe('old-1')
    expect(state.lastDecisionSource).toBe('cache')
  })

  it('clears all AI data and removes the persisted key (§6.5 一键恢复默认)', () => {
    useDynamicDesktopStore.getState().setEnabled(true)
    render(<SettingsApp />)
    openDynamicSection()

    fireEvent.click(screen.getByTestId('dynamic-desktop-clear'))
    const state = useDynamicDesktopStore.getState()
    // §6.5 恢复默认 = 出厂偏好（§32 动态桌面默认关）。
    expect(state.prefs.enabled).toBe(false)
    expect(state.currentPlan).toBeNull()
    expect(localStorage.getItem(`${DYNAMIC_DESKTOP_KEY_PREFIX}u1`)).toBeNull()
  })
})
