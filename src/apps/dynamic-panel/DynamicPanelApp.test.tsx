import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { resetAppStore } from '@/store/app-store'
import {
  resetDynamicDesktopStore,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { resetSettingsStore } from '@/store/settings-store'

import { DynamicPanelApp } from './DynamicPanelApp'

// 模块级注册一次（systemBus 是单例；vi.clearAllMocks 每个用例重置计数）。
const readySpy = vi.fn()
const decisionSpy = vi.fn()
systemBus.on('ai.content.ready', (payload) => readySpy(payload))
systemBus.on('ai.decision.performed', (payload) => decisionSpy(payload))

beforeEach(() => {
  vi.clearAllMocks()
  resetAppStore()
  resetDynamicDesktopStore()
  resetSettingsStore()
})

describe('DynamicPanelApp（DDS §5.1 域③，Phase B 本地切片）', () => {
  it('renders greeting, suggestion and tip cards with the AI badge', async () => {
    render(<DynamicPanelApp />)

    await waitFor(() => expect(screen.getAllByText(/AI 生成/).length).toBeGreaterThanOrEqual(2))
    expect(screen.getByTestId('panel-card-greeting')).toBeInTheDocument()
    expect(screen.getByTestId('panel-card-suggest')).toBeInTheDocument()
    expect(screen.getByTestId('panel-card-tip')).toBeInTheDocument()
    // 动态桌面关闭：无壁纸卡。
    expect(screen.queryByTestId('panel-card-wallpaper')).toBeNull()
    // 决策来源标识：本地规则（每张卡片都有）。
    expect(screen.getAllByText(/本地规则/).length).toBeGreaterThanOrEqual(2)
  })

  it('emits ai.content.ready and ai.decision.performed on assembly', async () => {
    render(<DynamicPanelApp />)
    await waitFor(() => expect(readySpy).toHaveBeenCalled())
    expect(readySpy.mock.calls[0]?.[0]).toMatchObject({ panelId: 'com.ageha.dynamic.panel' })
    expect(decisionSpy).toHaveBeenCalledWith({ domain: 'content', source: 'local' })
  })

  it('shows the wallpaper card once the dynamic desktop is on', async () => {
    const { buildWallpaperPlan, COMPOSITIONS } = await import('@/core/dynamic/generative/templates')
    const plan = buildWallpaperPlan({
      seed: 'p1',
      style: 'particle-nebula',
      paletteId: 'nebula-violet',
      compositionId: COMPOSITIONS[0].id,
      density: 0.1,
      zone: 'converge',
      reason: { signals: [], palette: 'nebula-violet', motif: 'particle-nebula' },
    })
    useDynamicDesktopStore.setState({
      currentPlan: plan,
      currentLevel: 'L0',
      prefs: { enabled: true, randomness: 40, hideBadge: false, pinned: null, blockedStyles: [] },
    })
    render(<DynamicPanelApp />)

    await waitFor(() => expect(screen.getByTestId('panel-card-wallpaper')).toBeInTheDocument())
    expect(screen.getByText(/粒子星云/)).toBeInTheDocument()
  })

  it('refresh button re-assembles the cards', async () => {
    render(<DynamicPanelApp />)
    await waitFor(() => expect(screen.getByTestId('dynamic-panel-cards').children.length).toBeGreaterThan(0))
    const countBefore = readySpy.mock.calls.length

    fireEvent.click(screen.getByTestId('dynamic-panel-refresh'))
    await waitFor(() => expect(readySpy.mock.calls.length).toBe(countBefore + 1))
  })
})
