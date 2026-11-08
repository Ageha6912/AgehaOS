import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    // 生成位置标识：本机（每张卡片都有；不再露出「本地规则」这类实现术语）。
    expect(screen.getAllByText(/AI 生成 · 本机/).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/本地规则/)).toBeNull()
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
    expect(screen.getByTestId('panel-decision-source').textContent).toBe('生成于 本机')
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
    expect(screen.getByTestId('panel-decision-source').textContent).toBe('生成于 云端 AI')
    // 卡片徽标必须与底栏一致（D2 审查：旧实现写死「本机」）。
    expect(within(screen.getByTestId('panel-card-tip')).getByText(/云端 AI/)).toBeInTheDocument()
  })

  it('ignores a stale LLM response that resolves after a newer assembly (D2 审查)', async () => {
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
    const pending: Array<(items: unknown[]) => void> = []
    requestAiSlots.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve as (items: unknown[]) => void)
        }),
    )
    render(<DynamicPanelApp />)
    await waitFor(() => expect(screen.getByTestId('panel-tip-body')).toBeInTheDocument())
    await waitFor(() => expect(pending.length).toBe(1))

    fireEvent.click(screen.getByTestId('dynamic-panel-refresh'))
    await waitFor(() => expect(pending.length).toBe(2))

    // 新装配先返回；旧响应随后到达，不得覆盖新内容。
    act(() => pending[1]?.([{ slotId: 'tip', text: '新装配文本：今天适合整理桌面。' }]))
    await waitFor(() =>
      expect(screen.getByTestId('panel-tip-body').textContent).toContain('新装配文本'),
    )
    act(() => pending[0]?.([{ slotId: 'tip', text: '旧装配文本：应被丢弃。' }]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('panel-tip-body').textContent).toContain('新装配文本')
    expect(screen.getByTestId('panel-tip-body').textContent).not.toContain('旧装配文本')
  })

  it('drops an in-flight LLM tip after llmEnhance is switched off (D2 审查)', async () => {
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
    let resolveTip: (items: unknown[]) => void = () => {}
    requestAiSlots.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTip = resolve as (items: unknown[]) => void
        }),
    )
    render(<DynamicPanelApp />)
    await waitFor(() => expect(screen.getByTestId('panel-tip-body')).toBeInTheDocument())

    act(() => {
      useDynamicDesktopStore.setState({
        prefs: { ...useDynamicDesktopStore.getState().prefs, llmEnhance: false },
      })
    })
    act(() => resolveTip([{ slotId: 'tip', text: '关闭后到达的文本：不应出现。' }]))
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('panel-tip-body').textContent).not.toContain('不应出现')
    expect(screen.getByTestId('panel-decision-source').textContent).toBe('生成于 本机')
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
    expect(screen.getByTestId('panel-decision-source').textContent).toBe('生成于 本机缓存')
    expect(within(screen.getByTestId('panel-card-tip')).getByText(/本机缓存/)).toBeInTheDocument()
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

    it('aborts a hung upload so the consent dialog cannot stay busy forever (D2 审查)', async () => {
      remoteAuth.active = true
      enableFreeTextTip()
      const fetchMock = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          }),
      )
      vi.stubGlobal('fetch', fetchMock)

      await reportFreeText()
      vi.useFakeTimers()
      try {
        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
        act(() => {
          vi.advanceTimersByTime(15_000)
        })
        await act(async () => {
          await Promise.resolve()
          await Promise.resolve()
        })

        expect(screen.queryByRole('dialog')).toBeNull()
        const items = useNotificationStore.getState().items
        expect(items[0]?.titleKey).toBe('cards.tip.uploadFailedTitle')
        expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

/**
 * 窄容器分支（M3-5）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；真实几何（单列
 * 实测 / 刷新钮命中区 / 零横向溢出）归 e2e/mobile-terminal-panel.spec.ts
 * （与 Calculator 窄容器组同一分工口径）。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** 手动喂一次观测回调（内容盒宽度）。真实 RO 在 observe 时必发初始帧。 */
  emit(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

describe('DynamicPanelApp 窄容器（M3-5）', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  })

  function renderWithWidth(width: number): void {
    render(<DynamicPanelApp />)
    act(() => {
      FakeResizeObserver.instances.at(-1)?.emit(width)
    })
  }

  it('窄容器：单列（双列档撤下）、刷新钮 44px 触控档、布局卡采纳/重置触控档可用', async () => {
    useDynamicDesktopStore.setState({
      prefs: { enabled: true, randomness: 40, hideBadge: false, pinned: null, blockedStyles: [], llmEnhance: false },
    })
    renderWithWidth(360)

    await waitFor(() => expect(screen.getByTestId('dynamic-panel-cards').children.length).toBeGreaterThan(0))
    const cards = screen.getByTestId('dynamic-panel-cards')
    expect(cards.className).toContain('grid-cols-1')
    expect(cards.className).not.toContain('min-[560px]:grid-cols-2')
    expect(screen.getByTestId('dynamic-panel-refresh').className).toContain('h-11')

    // 布局卡（动态桌面开 → 在场）：窄分支按钮触控档，采纳/重置流程照常。
    await waitFor(() => expect(screen.getByTestId('panel-card-layout')).toBeInTheDocument())
    expect(screen.getByTestId('layout-apply').className).toContain('min-h-[44px]')
    fireEvent.click(screen.getByTestId('layout-apply'))
    expect(useDynamicDesktopStore.getState().appliedLayout).not.toBeNull()
    expect(screen.getByTestId('layout-applied-badge')).toBeInTheDocument()
    expect(screen.getByTestId('layout-reset').className).toContain('min-h-[44px]')
    fireEvent.click(screen.getByTestId('layout-reset'))
    expect(useDynamicDesktopStore.getState().appliedLayout).toBeNull()
  })

  it('宽容器：卡片网格与刷新钮类名与改前字面等价（双列档保留）', async () => {
    render(<DynamicPanelApp />)

    await waitFor(() => expect(screen.getByTestId('dynamic-panel-cards').children.length).toBeGreaterThan(0))
    expect(screen.getByTestId('dynamic-panel-cards').className).toBe(
      'scroll-thin absolute inset-0 overflow-y-auto grid grid-cols-1 content-start gap-2 p-3 min-[560px]:grid-cols-2',
    )
    expect(screen.getByTestId('dynamic-panel-refresh').className).toBe(
      'flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-raised hover:text-text',
    )
  })
})
