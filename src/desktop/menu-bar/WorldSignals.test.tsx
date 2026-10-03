import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { utcDayKey } from '@/core/eclosion/world'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import type { EclosionWorldSummary } from '@/store/eclosion-store'

import { MenuBarWorldSignals } from './WorldSignals'

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

describe('MenuBarWorldSignals（§6.3 顶栏小字与来源列表）', () => {
  it('is hidden while eclosion is off, no world, a stale world, or a degraded one', () => {
    seedEclosionForTests('u-1', false)
    useEclosionStore.getState().applyWorld(worldSummary())
    const { unmount } = render(<MenuBarWorldSignals />)
    expect(screen.queryByTestId('menubar-world-signals')).toBeNull()
    unmount()
    resetEclosionStore()

    // 羽化开但世界未就绪。
    seedEclosionForTests('u-1', true)
    render(<MenuBarWorldSignals />)
    expect(screen.queryByTestId('menubar-world-signals')).toBeNull()
  })

  it('hides stale (non-today) and signal-free worlds', () => {
    seedEclosionForTests('u-1', true)
    const { unmount } = render(<MenuBarWorldSignals />)

    useEclosionStore.getState().applyWorld(worldSummary({ worldDate: '2000-01-01' }))
    expect(screen.queryByTestId('menubar-world-signals')).toBeNull()

    useEclosionStore.getState().applyWorld(
      worldSummary({ signalCount: 0, signals: { titles: [], sourceName: '', sourceUrl: '' }, degraded: true }),
    )
    expect(screen.queryByTestId('menubar-world-signals')).toBeNull()
    unmount()
  })

  it('shows the signal count note and expands the source list on click', () => {
    seedEclosionForTests('u-1', true)
    useEclosionStore.getState().applyWorld(worldSummary())
    render(<MenuBarWorldSignals />)

    const note = screen.getByTestId('menubar-world-signals')
    expect(note).toHaveTextContent('今日桌面由 2 条趋势信号生成')

    fireEvent.click(note)
    const panel = screen.getByTestId('menubar-world-signals-panel')
    expect(panel).toBeInTheDocument()
    expect(screen.getAllByTestId('menubar-world-signal').map((item) => item.textContent)).toEqual([
      '信号甲',
      '信号乙',
    ])
    // 来源名 + 来源链接（透明性）。
    expect(screen.getByTestId('menubar-world-signals-source-link')).toHaveAttribute(
      'href',
      'https://example.invalid/feed',
    )
  })

  it('closes the panel on Escape and outside pointer-down (弹层契约)', () => {
    seedEclosionForTests('u-1', true)
    useEclosionStore.getState().applyWorld(worldSummary())
    render(<MenuBarWorldSignals />)

    fireEvent.click(screen.getByTestId('menubar-world-signals'))
    expect(screen.getByTestId('menubar-world-signals-panel')).toBeInTheDocument()

    // Esc 关闭（usePopoverDismiss 捕获阶段契约）。
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('menubar-world-signals-panel')).toBeNull()

    // 外部按下同样关闭。
    fireEvent.click(screen.getByTestId('menubar-world-signals'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('menubar-world-signals-panel')).toBeNull()
  })
})
