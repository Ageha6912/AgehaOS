import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { utcDayKey } from '@/core/eclosion/world'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import type { EclosionWorldSummary } from '@/store/eclosion-store'

import { WorldSignalsSection } from './WorldSignals'

const worldSummary = (overrides: Partial<EclosionWorldSummary> = {}): EclosionWorldSummary => ({
  worldDate: utcDayKey(),
  headline: '本地智能体与边缘推理的清晨',
  paletteId: 'nebula-violet',
  accentHue: 212,
  degraded: false,
  signalCount: 2,
  signals: {
    titles: ['信号甲', '信号乙'],
    sourceName: 'GitHub Trending',
    sourceUrl: 'https://example.invalid/feed',
  },
  apps: [],
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  resetEclosionStore()
})

afterEach(() => {
  resetEclosionStore()
})

describe('WorldSignalsSection（§6.3 世界卡内信号行与来源列表；Shell 3.1 STEP 3 自顶栏迁入）', () => {
  it('is hidden while eclosion is off, no world, a stale world, or a degraded one', () => {
    seedEclosionForTests('u-1', false)
    useEclosionStore.getState().applyWorld(worldSummary())
    const { unmount } = render(<WorldSignalsSection />)
    expect(screen.queryByTestId('widgets-world-signals')).toBeNull()
    unmount()
    resetEclosionStore()

    // 羽化开但世界未就绪。
    seedEclosionForTests('u-1', true)
    render(<WorldSignalsSection />)
    expect(screen.queryByTestId('widgets-world-signals')).toBeNull()
  })

  it('hides stale (non-today) and signal-free worlds', () => {
    seedEclosionForTests('u-1', true)
    const { unmount } = render(<WorldSignalsSection />)

    useEclosionStore.getState().applyWorld(worldSummary({ worldDate: '2000-01-01' }))
    expect(screen.queryByTestId('widgets-world-signals')).toBeNull()

    useEclosionStore.getState().applyWorld(
      worldSummary({ signalCount: 0, signals: { titles: [], sourceName: '', sourceUrl: '' }, degraded: true }),
    )
    expect(screen.queryByTestId('widgets-world-signals')).toBeNull()
    unmount()
  })

  it('shows the signal count note and expands the source list on click', () => {
    seedEclosionForTests('u-1', true)
    useEclosionStore.getState().applyWorld(worldSummary())
    render(<WorldSignalsSection />)

    const note = screen.getByTestId('widgets-world-signals')
    expect(note).toHaveTextContent('由 2 条趋势信号织成 · 来源')

    fireEvent.click(note)
    const panel = screen.getByTestId('widgets-world-signals-panel')
    expect(panel).toBeInTheDocument()
    expect(screen.getAllByTestId('widgets-world-signal').map((item) => item.textContent)).toEqual([
      '信号甲',
      '信号乙',
    ])
    // 来源名 + 来源链接（透明性）。
    expect(screen.getByTestId('widgets-world-signals-source-link')).toHaveAttribute(
      'href',
      'https://example.invalid/feed',
    )
  })

  it('closes the panel on Escape and outside pointer-down (弹层契约)', () => {
    seedEclosionForTests('u-1', true)
    useEclosionStore.getState().applyWorld(worldSummary())
    render(<WorldSignalsSection />)

    fireEvent.click(screen.getByTestId('widgets-world-signals'))
    expect(screen.getByTestId('widgets-world-signals-panel')).toBeInTheDocument()

    // Esc 关闭（usePopoverDismiss 捕获阶段契约）。
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('widgets-world-signals-panel')).toBeNull()

    // 外部按下同样关闭。
    fireEvent.click(screen.getByTestId('widgets-world-signals'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('widgets-world-signals-panel')).toBeNull()
  })

  it('shows a busy state while regenerating and surfaces failures inline (§6.2 个人重生成)', async () => {
    seedEclosionForTests('u-1', true)
    useEclosionStore.getState().applyWorld(worldSummary())
    let resolveRegenerate: (ok: boolean) => void = () => {}
    const regenerate = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRegenerate = resolve
        }),
    )
    render(<WorldSignalsSection onRegenerate={regenerate} />)

    fireEvent.click(screen.getByTestId('widgets-world-signals'))
    const button = screen.getByTestId('widgets-world-regenerate')
    expect(button).toBeInTheDocument()

    // 忙碌态：禁用 + 生成中文案，连点无效。
    fireEvent.click(button)
    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    expect(screen.getByTestId('widgets-world-regenerate').textContent).toContain('生成中')

    // 失败：页内提示出现（4s 自动消退不在此测）。
    resolveRegenerate(false)
    await screen.findByTestId('widgets-world-regenerate-failed')
    expect(screen.getByTestId('widgets-world-regenerate').textContent).toContain('重新生成今日世界')

    // 成功：无失败提示，可再次触发。
    fireEvent.click(screen.getByTestId('widgets-world-regenerate'))
    resolveRegenerate(true)
    await vi.waitFor(() => {
      expect(screen.queryByTestId('widgets-world-regenerate-failed')).toBeNull()
    })
    expect(regenerate).toHaveBeenCalledTimes(2)
  })
})
