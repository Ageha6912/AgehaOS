import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerBuiltinApps, resetAppStore } from '@/store/app-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetNotificationStore } from '@/store/notification-store'
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
  await seedFile()
})

function openPalette(): void {
  act(() => {
    useSearchStore.getState().setOpen(true)
  })
}

describe('SearchPalette (PRD §15)', () => {
  it('renders viewport-centered with the scrim token (§23)', () => {
    useSearchStore.setState({ open: true })
    render(<SearchPalette />)

    const backdrop = screen.getByTestId('search-backdrop')
    expect(backdrop.classList.contains('items-center')).toBe(true)
    expect(backdrop.classList.contains('justify-center')).toBe(true)
    expect(backdrop.classList.contains('bg-scrim')).toBe(true)

    const palette = screen.getByTestId('search-palette')
    expect(palette.classList.contains('w-[38rem]')).toBe(true)
    expect(palette.classList.contains('shadow-popover')).toBe(true)
    expect(palette.classList.contains('rounded-xl')).toBe(true)
    // 材质表⑥（Shell 2.0 §4.2⑥）：弹层深玻璃档——glass-popover 挂上
    // --ag-glass-bg-strong（白86%；chrome 作用域自动白26%）+ 44px blur，
    // 档位独立于 z-30 窗口层的 surface-glass 基底（白72% + 28px）。
    expect(palette.classList.contains('surface-glass')).toBe(true)
    expect(palette.classList.contains('glass-popover')).toBe(true)
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
    expect(item.textContent).toContain('想象一个「notes」应用')
    // 域序恒定：应用头 → 文件头 → 想象项（§7 始终排最后）。
    const appsHeader = screen.getByText('应用')
    const filesHeader = screen.getByText('文件')
    expect(appsHeader.compareDocumentPosition(filesHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(filesHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
