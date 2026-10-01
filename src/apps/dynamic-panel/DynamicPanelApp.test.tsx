import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { resetAppStore } from '@/store/app-store'
import {
  resetDynamicDesktopStore,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetSettingsStore } from '@/store/settings-store'

import { DynamicPanelApp } from './DynamicPanelApp'

const requestAiSlots = vi.fn()

vi.mock('@/core/dynamic/llm/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/dynamic/llm/client')>()
  return {
    ...actual,
    requestAiSlots: (...args: unknown[]) => requestAiSlots(...args),
  }
})

// 样本上传确认框仅远程模式提供（§8.6）；本地模式保持纯本机撤下。
const remoteAuth = vi.hoisted(() => ({ active: false }))

vi.mock('@/core/auth/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth/provider')>()
  return {
    ...actual,
    isRemoteAuthActive: () => remoteAuth.active,
  }
})

// 模块级注册一次（systemBus 是单例；vi.clearAllMocks 每个用例重置计数）。
const readySpy = vi.fn()
const decisionSpy = vi.fn()
const layoutSpy = vi.fn()
systemBus.on('ai.content.ready', (payload) => readySpy(payload))
systemBus.on('ai.decision.performed', (payload) => decisionSpy(payload))
systemBus.on('desktop.layout.suggested', (payload) => layoutSpy(payload))

beforeEach(() => {
  vi.clearAllMocks()
  resetAppStore()
  resetDynamicDesktopStore()
  resetSettingsStore()
  resetNotificationStore()
  remoteAuth.active = false
  requestAiSlots.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
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
      prefs: { enabled: true, randomness: 40, hideBadge: false, pinned: null, blockedStyles: [], llmEnhance: false },
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

  it('lays cards out in a two-column grid for the landscape default (§30)', async () => {
    render(<DynamicPanelApp />)
    await waitFor(() => expect(screen.getByTestId('dynamic-panel-cards').children.length).toBeGreaterThan(0))
    expect(screen.getByTestId('dynamic-panel-cards').className).toContain('min-[560px]:grid-cols-2')
  })

  it('offers no layout card while the dynamic desktop is off', async () => {
    useDynamicDesktopStore.setState({
      prefs: { enabled: false, randomness: 40, hideBadge: false, pinned: null, blockedStyles: [], llmEnhance: false },
    })
    render(<DynamicPanelApp />)
    await waitFor(() => expect(screen.getByTestId('panel-card-greeting')).toBeInTheDocument())
    expect(screen.queryByTestId('panel-card-layout')).toBeNull()
    expect(layoutSpy).not.toHaveBeenCalled()
  })

  it('shows the layout card with apply/reset when the dynamic desktop is on', async () => {
    useDynamicDesktopStore.setState({
      prefs: { enabled: true, randomness: 40, hideBadge: false, pinned: null, blockedStyles: [], llmEnhance: false },
    })
    render(<DynamicPanelApp />)

    await waitFor(() => expect(screen.getByTestId('panel-card-layout')).toBeInTheDocument())
    expect(layoutSpy).toHaveBeenCalled()
    expect(layoutSpy.mock.calls[0]?.[0]).toMatchObject({ layoutId: expect.any(String) })
    expect(decisionSpy).toHaveBeenCalledWith({ domain: 'layout', source: 'local' })

    // 采纳 → 写入 store；重置 → 清空。
    fireEvent.click(screen.getByTestId('layout-apply'))
    expect(useDynamicDesktopStore.getState().appliedLayout).not.toBeNull()
    expect(screen.getByTestId('layout-applied-badge')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('layout-reset'))
    expect(useDynamicDesktopStore.getState().appliedLayout).toBeNull()
  })

  it('skips LLM enhancement unless both the master switch and the opt-in are on', async () => {
    useDynamicDesktopStore.setState({
      prefs: {
        enabled: true,
        randomness: 40,
        hideBadge: false,
        pinned: null,
        blockedStyles: [],
        llmEnhance: false,
      },
    })
    render(<DynamicPanelApp />)
    await waitFor(() => expect(screen.getByTestId('panel-card-greeting')).toBeInTheDocument())
    await Promise.resolve()
    expect(requestAiSlots).not.toHaveBeenCalled()
    expect(screen.getByTestId('panel-decision-source').textContent).toContain('本地规则')
  })

  it('upgrades the tip card from an accepted LLM slot without blocking assembly', async () => {
    useDynamicDesktopStore.setState({
      prefs: {
        enabled: true,
        randomness: 40,
        hideBadge: false,
        pinned: null,
        blockedStyles: [],
        llmEnhance: true,
      },
    })
    requestAiSlots.mockResolvedValue([{ slotId: 'tip', text: 'shortcut' }])
    render(<DynamicPanelApp />)

    // 本地装配先上屏（异步增强不阻塞）。
    await waitFor(() => expect(screen.getByTestId('panel-tip-body')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('panel-tip-body').textContent).toContain('随机度'))
    expect(decisionSpy).toHaveBeenCalledWith({ domain: 'content', source: 'llm' })
    expect(screen.getByTestId('panel-decision-source').textContent).toContain('云端模型')
  })

  it('falls back to the cached slot when the LLM call fails', async () => {
    const client = await import('@/core/dynamic/llm/client')
    client.resetAiSessionState()
    vi.spyOn(client, 'getCachedAiSlots').mockReturnValue([{ slotId: 'tip', text: 'privacy' }])
    useDynamicDesktopStore.setState({
      prefs: {
        enabled: true,
        randomness: 40,
        hideBadge: false,
        pinned: null,
        blockedStyles: [],
        llmEnhance: true,
      },
    })
    requestAiSlots.mockRejectedValue(new Error('ai-http-503'))
    render(<DynamicPanelApp />)

    await waitFor(() => expect(screen.getByTestId('panel-tip-body').textContent).toContain('数据不会离开'))
    expect(screen.getByTestId('panel-decision-source').textContent).toContain('缓存重放')
  })

  it('renders filter-passed free text with a report takedown (Phase C / §8.6)', async () => {
    const client = await import('@/core/dynamic/llm/client')
    client.resetAiSessionState()
    const blockedSpy = vi.fn()
    systemBus.on('ai.content.blocked', (payload) => blockedSpy(payload))
    useDynamicDesktopStore.setState({
      prefs: {
        enabled: true,
        randomness: 40,
        hideBadge: false,
        pinned: null,
        blockedStyles: [],
        llmEnhance: true,
      },
    })
    requestAiSlots.mockResolvedValue([{ slotId: 'tip', text: '今天适合把窗口排成两列，效率更高。' }])
    render(<DynamicPanelApp />)

    await waitFor(() =>
      expect(screen.getByTestId('panel-tip-body').textContent).toContain('两列'),
    )
    // 自由文本带举报按钮；点击立即撤下并发事件。
    fireEvent.click(screen.getByTestId('panel-tip-report'))
    await waitFor(() =>
      expect(screen.getByTestId('panel-tip-body').textContent).not.toContain('两列'),
    )
    expect(blockedSpy).toHaveBeenCalledWith({ panelId: 'com.ageha.dynamic.panel', reason: 'reported' })
    // 封禁后同一文本不再被接受。
    expect(client.isContentBanned('今天适合把窗口排成两列，效率更高。')).toBe(true)
    // 本地模式：不弹同意框、不发上传请求（§8.6 不经确认不上传）。
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('样本上传确认框（§8.6，仅远程模式）', () => {
    const SAMPLE_TEXT = '今天适合把窗口排成两列，效率更高。'

    function enableFreeTextTip(): void {
      useDynamicDesktopStore.setState({
        prefs: {
          enabled: true,
          randomness: 40,
          hideBadge: false,
          pinned: null,
          blockedStyles: [],
          llmEnhance: true,
        },
      })
      requestAiSlots.mockResolvedValue([{ slotId: 'tip', text: SAMPLE_TEXT }])
    }

    async function reportFreeText(): Promise<void> {
      render(<DynamicPanelApp />)
      await waitFor(() =>
        expect(screen.getByTestId('panel-tip-body').textContent).toContain('两列'),
      )
      fireEvent.click(screen.getByTestId('panel-tip-report'))
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    }

    it('asks for consent in remote mode and uploads anonymously on confirm', async () => {
      remoteAuth.active = true
      enableFreeTextTip()
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 })
      vi.stubGlobal('fetch', fetchMock)

      await reportFreeText()
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dynamic/samples',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)).toEqual({
        text: SAMPLE_TEXT,
      })
    })

    it('cancel keeps the takedown local and never sends a request', async () => {
      remoteAuth.active = true
      enableFreeTextTip()
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const client = await import('@/core/dynamic/llm/client')
      client.resetAiSessionState()

      await reportFreeText()
      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      // 撤下与封禁语义不受选择影响。
      expect(client.isContentBanned(SAMPLE_TEXT)).toBe(true)
    })

    it('notifies transparently when the upload fails or is rejected', async () => {
      remoteAuth.active = true
      enableFreeTextTip()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }))

      await reportFreeText()
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      const items = useNotificationStore.getState().items
      expect(items[0]?.titleKey).toBe('cards.tip.uploadFailedTitle')
      expect(items[0]?.bodyKey).toBe('cards.tip.uploadFailedBody')
    })
  })
})
