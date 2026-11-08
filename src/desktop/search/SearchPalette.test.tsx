import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerBuiltinApps, resetAppStore } from '@/store/app-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetNotificationStore } from '@/store/notification-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import type { VfsSearchResult } from '@/core/filesystem/types'
import { systemVfs } from '@/services/vfs'

import { SearchPalette } from './SearchPalette'

async function seedFile(): Promise<void> {
  await systemVfs.writeFile('/Documents/meeting-notes.txt', 'agenda')
}

beforeEach(async () => {
  resetSearchStore()
  resetAppStore()
  registerBuiltinApps()
  resetWindowStore()
  resetNotificationStore()
  resetUsageStore()
  await seedFile()
})

function openPalette(): void {
  act(() => {
    useSearchStore.getState().setOpen(true)
  })
}

describe('SearchPalette (PRD §15 · Shell 3.0 STEP 9)', () => {
  it('renders viewport-centered with the scrim token and Raycast panel chrome (§23/STEP 9)', () => {
    useSearchStore.setState({ open: true })
    render(<SearchPalette />)

    const backdrop = screen.getByTestId('search-backdrop')
    expect(backdrop.classList.contains('items-center')).toBe(true)
    expect(backdrop.classList.contains('justify-center')).toBe(true)
    expect(backdrop.classList.contains('bg-scrim')).toBe(true)

    const palette = screen.getByTestId('search-palette')
    // STEP 9 宽度档：640px（600-720 Raycast/Spotlight 档）。
    expect(palette.classList.contains('w-[40rem]')).toBe(true)
    expect(palette.classList.contains('shadow-popover')).toBe(true)
    expect(palette.classList.contains('rounded-xl')).toBe(true)
    // 材质表⑥（Shell 2.0 §4.2⑥）：弹层深玻璃档——glass-popover 挂上
    // --ag-glass-bg-strong（白86%；chrome 作用域自动白26%）+ 44px blur，
    // 档位独立于 z-30 窗口层的 surface-glass 基底（白72% + 28px）。
    expect(palette.classList.contains('surface-glass')).toBe(true)
    expect(palette.classList.contains('glass-popover')).toBe(true)

    // 结构 Search → 结果区 → 底部按键提示条；空查询（无最近使用）显示
    // 诚实的引导文案（无假数据）。
    expect(screen.getByTestId('search-footer')).toBeInTheDocument()
    expect(screen.getByText('输入以搜索应用与文件')).toBeInTheDocument()
  })

  it('is hidden until opened and shows app results while typing', async () => {
    render(<SearchPalette />)
    expect(screen.queryByTestId('search-palette')).toBeNull()

    openPalette()
    expect(screen.getByTestId('search-palette')).toBeInTheDocument()

    await userEvent.type(screen.getByTestId('search-input'), '记')
    await waitFor(() => expect(screen.getAllByTestId('search-result-app')).toHaveLength(1))
    expect(screen.getByText('记事')).toBeInTheDocument()
    expect(screen.getByText('应用')).toBeInTheDocument()
  })

  it('finds files by name alongside apps and opens the active result with Enter', async () => {
    render(<SearchPalette />)
    openPalette()

    await userEvent.type(screen.getByTestId('search-input'), 'meeting')
    await waitFor(() => expect(screen.getAllByTestId('search-result-file')).toHaveLength(1))

    // 应用域为空 → 活动项即文件结果；Enter 打开 Files（§24.3 携参启动待办）。
    await userEvent.type(screen.getByTestId('search-input'), '{Enter}')
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe('com.ageha.files')
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('ignores Enter/Escape during IME composition, restores the gestures after', () => {
    render(<SearchPalette />)
    openPalette()
    const input = screen.getByTestId('search-input')

    // 组合期：Enter 确认候选词不得开窗，Esc 取消选词不得关面板。
    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(composingEnter, 'isComposing', { value: true })
    fireEvent(input, composingEnter)
    const composingEsc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(composingEsc, 'isComposing', { value: true })
    fireEvent(input, composingEsc)

    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(useSearchStore.getState().open).toBe(true)

    // 组合结束后同键位恢复正常手势：Esc 关面板。
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('moves the active result with arrow keys', async () => {
    render(<SearchPalette />)
    openPalette()

    // notes + settings 同含字母 e 的应用域：记事/设置/文件 应用三选。
    await userEvent.type(screen.getByTestId('search-input'), 'e')
    const input = screen.getByTestId('search-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const results = screen.getAllByTestId('search-result-app')
    expect(results[2]?.className).toContain('bg-primary/10')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByTestId('search-result-app')[1]?.className).toContain('bg-primary/10')
  })

  it('clamps the active row when async results arrive after an empty ArrowDown (E2 审查)', async () => {
    let resolveSearch: (results: VfsSearchResult[]) => void = () => {}
    const searchSpy = vi.spyOn(systemVfs, 'search').mockReturnValue(
      new Promise<VfsSearchResult[]>((resolve) => {
        resolveSearch = resolve
      }),
    )
    try {
      render(<SearchPalette />)
      openPalette()

      const input = screen.getByTestId('search-input')
      await userEvent.type(input, 'zzz')
      // 应用/想象域无命中、文件检索在途 → total = 0；旧实现 ↓ 会把 active 弄成 -1。
      expect(screen.queryByTestId('search-result-file')).toBeNull()
      fireEvent.keyDown(input, { key: 'ArrowDown' })

      await act(async () => {
        resolveSearch([
          { node: { name: 'zzz.txt' } as VfsSearchResult['node'], path: '/Documents/zzz.txt' },
        ])
      })
      await waitFor(() => expect(screen.getAllByTestId('search-result-file')).toHaveLength(1))

      // 结果到达后第一行即激活（钳制到 0），Enter 正常打开文件而不是静默无动作。
      expect(screen.getAllByTestId('search-result-file')[0]?.className).toContain('bg-primary/10')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(useWindowStore.getState().windows.some((w) => w.appId === 'com.ageha.files')).toBe(true)
    } finally {
      searchSpy.mockRestore()
    }
  })

  it('shows real recent apps on empty query and reaches them by keyboard (STEP 9)', async () => {
    // 最新在前（usage-store 语义）：终端 → 记事。
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    useUsageStore.getState().recordRecentApp('com.ageha.terminal')
    render(<SearchPalette />)
    openPalette()

    // 空查询 = 真实「最近使用」速览（与启动器 Recent 同一数据源）。
    const recents = screen.getAllByTestId('search-result-recent')
    expect(recents).toHaveLength(2)
    expect(recents[0]).toHaveAccessibleName('终端')
    expect(recents[1]).toHaveAccessibleName('记事')
    expect(screen.getByText('最近')).toBeInTheDocument()

    // 无需输入即可键盘直达：↓ 到第二行（记事）→ Enter 开窗并关闭面板。
    const input = screen.getByTestId('search-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(recents[1]?.className).toContain('bg-primary/10')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.notes')
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('hides the recents glance once a query is typed', async () => {
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    render(<SearchPalette />)
    openPalette()
    expect(screen.getAllByTestId('search-result-recent')).toHaveLength(1)

    await userEvent.type(screen.getByTestId('search-input'), '记')
    await waitFor(() => expect(screen.getAllByTestId('search-result-app')).toHaveLength(1))
    expect(screen.queryByTestId('search-result-recent')).toBeNull()
  })

  it('shows the empty state for queries with no matches', async () => {
    render(<SearchPalette />)
    openPalette()

    await userEvent.type(screen.getByTestId('search-input'), 'zzzz')
    await waitFor(() => expect(screen.getByText('无匹配结果')).toBeInTheDocument())
  })

  it('closes on backdrop click and Escape', async () => {
    render(<SearchPalette />)
    openPalette()

    fireEvent.click(screen.getByTestId('search-backdrop'))
    expect(useSearchStore.getState().open).toBe(false)

    openPalette()
    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' })
    expect(useSearchStore.getState().open).toBe(false)
  })
})

// ── 想象域（AI-GENERATED-APPS-DESIGN §7，P3） ───────────────────────────────

import { imagineAppIdForQuery } from '@/core/eclosion/spec'
import { resetEclosionStore, seedEclosionForTests } from '@/store/eclosion-store'
import { systemEclosion } from '@/services/eclosion'

const SEARCH_USER = 'u-search'

/** 单例编排器的假传输：/quota 快照 + generate 的 SSE 单文档响应。 */
function wireSystemEclosion(responses: Array<Response | Error>): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = []
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith('/quota')) {
      return new Response(
        JSON.stringify({
          configured: true,
          quotas: {
            basic: { used: 0, limit: 10 },
            today: { used: 0, limit: 30 },
            imagine: { used: 0, limit: 20 },
          },
          resetAtIso: '2026-10-03T00:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    calls.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {})
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (next === undefined) return new Response('{}', { status: 500 })
    return next
  })
  systemEclosion.configureForTests({ fetcher })
  return calls
}

const sseDoc = (html: string): Response =>
  new Response(`event: delta\ndata: ${JSON.stringify({ text: html })}\n\nevent: done\ndata: {}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })

describe('SearchPalette 想象域（§7）', () => {
  beforeEach(() => {
    resetEclosionStore()
    seedEclosionForTests(SEARCH_USER, true)
  })

  it('shows the imagine domain last (apps → files → imagine) once ≥2 chars with eclosion on', async () => {
    wireSystemEclosion([])
    render(<SearchPalette />)
    openPalette()

    // 'notes' 同时命中应用域（com.ageha.notes）与文件域（meeting-notes.txt）。
    await userEvent.type(screen.getByTestId('search-input'), 'notes')
    await waitFor(() => expect(screen.getAllByTestId('search-result-file')).toHaveLength(1))

    const item = screen.getByTestId('search-result-imagine')
    expect(item).toBeInTheDocument()
    expect(item.textContent).toContain('即时羽化「notes」应用')
    // 域序恒定：应用头 → 文件头 → 想象项（§7 始终排最后）。
    const appsHeader = screen.getByText('应用')
    const filesHeader = screen.getByText('文件')
    expect(appsHeader.compareDocumentPosition(filesHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(filesHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // STEP 9：想象域落位 Actions 区（「操作」头在文件头之后、想象项之前）。
    const actionsHeader = screen.getByText('操作')
    expect(filesHeader.compareDocumentPosition(actionsHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actionsHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the imagine item for violations and while eclosion is off (客户端过滤半场)', async () => {
    const calls = wireSystemEclosion([])
    render(<SearchPalette />)
    openPalette()

    await userEvent.type(screen.getByTestId('search-input'), '赌博')
    // 违规词（filterContentText violation）：不显示想象项，也绝无生成请求。
    expect(screen.queryByTestId('search-result-imagine')).toBeNull()

    await userEvent.clear(screen.getByTestId('search-input'))
    seedEclosionForTests(SEARCH_USER, false)
    await userEvent.type(screen.getByTestId('search-input'), '番茄钟')
    expect(screen.queryByTestId('search-result-imagine')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('Enter on the imagine item generates (kind=imagine) and opens its window', async () => {
    const calls = wireSystemEclosion([
      sseDoc('<!doctype html><html><body><div>imagined</div></body></html>'),
    ])
    render(<SearchPalette />)
    openPalette()

    // 无应用/文件命中：想象项即唯一结果（active=0），Enter 直接生成。
    await userEvent.type(screen.getByTestId('search-input'), '番茄钟')
    const item = screen.getByTestId('search-result-imagine')
    expect(item.className).toContain('bg-primary/10')
    await userEvent.type(screen.getByTestId('search-input'), '{Enter}')

    expect(useSearchStore.getState().open).toBe(false)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ kind: 'imagine', query: '番茄钟' })
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe(imagineAppIdForQuery('番茄钟'))
    expect(windows[0]?.title).toBe('番茄钟')
  })

  it('arrow keys walk the three segments in order and Enter generates from the imagine row', async () => {
    const calls = wireSystemEclosion([
      sseDoc('<!doctype html><html><body><div>imagined</div></body></html>'),
    ])
    render(<SearchPalette />)
    openPalette()

    // 应用域 1 命中 + 想象项：↓ 两次到想象行，Enter 生成而非 launchApp。
    await userEvent.type(screen.getByTestId('search-input'), '记事')
    await waitFor(() => expect(screen.getAllByTestId('search-result-app')).toHaveLength(1))
    const input = screen.getByTestId('search-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByTestId('search-result-imagine').className).toContain('bg-primary/10')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useSearchStore.getState().open).toBe(false)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ kind: 'imagine' })
    expect(useWindowStore.getState().windows[0]?.appId).toBe(imagineAppIdForQuery('记事'))
  })
})
