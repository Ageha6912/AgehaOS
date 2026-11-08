import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SampleReviewSection } from './SampleReviewSection'

const fetchMock = vi.fn()

function okGet(samples: unknown[], hasMore = false): Response {
  return { ok: true, status: 200, json: async () => ({ samples, hasMore }) } as Response
}

/** 列表请求现在带分页 query；DELETE 走 /samples/<id> 子路径。 */
function isListRequest(url: string | URL | Request): boolean {
  const href = String(url)
  return href === '/api/dynamic/samples' || href.startsWith('/api/dynamic/samples?')
}

const SAMPLES = [
  {
    id: 's2',
    text: '较晚的样本：加我微信 abc12345 领福利',
    classification: 'misleading',
    createdAt: '2026-09-28T15:20:00.000Z',
  },
  {
    id: 's1',
    text: '较早的样本：今天适合把窗口排成两列，效率更高。',
    classification: 'ok',
    createdAt: '2026-09-28T15:18:21.227Z',
  },
]

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('SampleReviewSection（DDS §8.6 复审视图，仅 admin 分区挂载）', () => {
  it('loads and lists samples newest first with classification badges', async () => {
    fetchMock.mockResolvedValueOnce(okGet(SAMPLES))
    render(<SampleReviewSection />)

    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/dynamic/samples?limit=50&offset=0', {
      credentials: 'same-origin',
    })
    // 新样本在前（服务端排序，UI 保持原序）。
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('较晚的样本')
    // 分类徽标 + 等宽时间戳。
    expect(screen.getByText('误导')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(screen.getByText('2026-09-28T15:18:21.227Z')).toBeInTheDocument()
    // 计数走 formatMessage 插值。
    expect(screen.getByText('2 条样本')).toBeInTheDocument()
  })

  it('shows the empty hint when there are no samples', async () => {
    fetchMock.mockResolvedValueOnce(okGet([]))
    render(<SampleReviewSection />)

    await waitFor(() => expect(screen.getByTestId('sample-review-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('sample-review-list')).toBeNull()
  })

  it('shows an alert when the endpoint fails (non-admin/offline)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 } as Response)
    render(<SampleReviewSection />)

    await waitFor(() => expect(screen.getByTestId('sample-review-error')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('样本清单加载失败。')
  })

  it('recovers from a rejected fetch on manual refresh', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network-down'))
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-error')).toBeInTheDocument())

    fetchMock.mockResolvedValueOnce(okGet(SAMPLES))
    fireEvent.click(screen.getByTestId('sample-review-refresh'))
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())
    expect(screen.queryByTestId('sample-review-error')).toBeNull()
  })

  it('refresh re-fetches the list', async () => {
    fetchMock.mockResolvedValue(okGet(SAMPLES))
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())
    const callsAfterLoad = fetchMock.mock.calls.length

    fireEvent.click(screen.getByTestId('sample-review-refresh'))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsAfterLoad + 1))
  })

  it('loads more samples page by page until the server says no more (D2 审查)', async () => {
    fetchMock.mockImplementation((url: string | URL | Request) => {
      const href = String(url)
      if (href.includes('offset=0')) return Promise.resolve(okGet([SAMPLES[0]], true))
      if (href.includes('offset=1')) return Promise.resolve(okGet([SAMPLES[1]], false))
      return Promise.resolve({ ok: false, status: 500 } as Response)
    })
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('sample-review-load-more'))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    // 第二页用已加载条数当 offset；服务端 hasMore=false 后按钮消失。
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('offset=1'))).toBe(true)
    expect(screen.queryByTestId('sample-review-load-more')).toBeNull()
  })

  it('keeps the loaded rows and reports when loading more fails (D2 审查)', async () => {
    fetchMock.mockImplementation((url: string | URL | Request) => {
      const href = String(url)
      if (href.includes('offset=0')) return Promise.resolve(okGet([SAMPLES[0]], true))
      return Promise.resolve({ ok: false, status: 503 } as Response)
    })
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('sample-review-load-more'))
    await waitFor(() =>
      expect(screen.getByTestId('sample-review-load-more-error')).toBeInTheDocument(),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('加载更多失败。')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    // 失败后按钮保留，可重试。
    expect(screen.getByTestId('sample-review-load-more')).toBeInTheDocument()
  })

  it('deletes a reviewed sample and updates the list and count', async () => {
    fetchMock.mockImplementation((url: string | URL | Request) => {
      if (isListRequest(url)) {
        return Promise.resolve(okGet(SAMPLES))
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ deleted: true }) } as Response)
    })
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())

    fireEvent.click(screen.getAllByTestId('sample-review-delete')[0])
    // 删除不可撤销：先过二次确认（D2 审查）。
    expect(screen.getByRole('dialog', { name: '删除样本' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByText('1 条样本')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/dynamic/samples/s')) ?? []
    expect(String(url)).toMatch(/\/api\/dynamic\/samples\/s[12]$/)
    expect(init).toMatchObject({ method: 'DELETE', credentials: 'same-origin' })
  })

  it('does not delete when the confirmation is cancelled', async () => {
    fetchMock.mockImplementation((url: string | URL | Request) => {
      if (isListRequest(url)) {
        return Promise.resolve(okGet(SAMPLES))
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ deleted: true }) } as Response)
    })
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())

    fireEvent.click(screen.getAllByTestId('sample-review-delete')[0])
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/dynamic/samples/s'))).toBe(false)
  })

  it('keeps the row and shows an alert when deletion fails', async () => {
    fetchMock.mockImplementation((url: string | URL | Request) => {
      if (isListRequest(url)) {
        return Promise.resolve(okGet(SAMPLES))
      }
      return Promise.resolve({ ok: false, status: 404 } as Response)
    })
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())

    fireEvent.click(screen.getAllByTestId('sample-review-delete')[0])
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    await waitFor(() => expect(screen.getByTestId('sample-review-delete-error')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('样本删除失败。')
    // 行保留：数据不静默丢失。
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // 确认框在失败后关闭，告警留在页面上。
    expect(screen.queryByRole('dialog')).toBeNull()

    // 刷新后旧的成功/失败告警都必须复位（D2 审查）。
    fetchMock.mockResolvedValueOnce(okGet(SAMPLES))
    fireEvent.click(screen.getByTestId('sample-review-refresh'))
    await waitFor(() => expect(screen.queryByTestId('sample-review-delete-error')).toBeNull())
  })
})

// ── 来源筛选（P4 §10：「羽化应用」举报标记 + 摘要呈现） ──────────────────────

const MIXED_SAMPLES = [
  {
    id: 'e1',
    text: '时钟 · 显示时间 · 时钟',
    classification: 'ok',
    createdAt: '2026-10-03T01:00:00.000Z',
    source: 'eclosion',
    detail: '<!doctype html><html><body>clock</body></html>',
  },
  {
    id: 's1',
    text: '较早的样本：今天适合把窗口排成两列，效率更高。',
    classification: 'ok',
    createdAt: '2026-09-28T15:18:21.227Z',
  },
]

describe('SampleReviewSection × 来源筛选（P4 §10）', () => {
  it('badges eclosion reports and renders their generated-content excerpt', async () => {
    fetchMock.mockResolvedValueOnce(okGet(MIXED_SAMPLES))
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())

    // 来源徽标 + 摘要（HTML 前 2KB 摘要按原文呈现）只出现在羽化举报行。
    expect(screen.getByTestId('sample-review-source-badge').textContent).toContain('羽化应用')
    expect(screen.getByText(/<!doctype html>/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('filters the list to eclosion-sourced samples and back', async () => {
    fetchMock.mockResolvedValueOnce(okGet(MIXED_SAMPLES))
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())

    // 默认「全部来源」。
    expect(screen.getByTestId('sample-review-filter-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2 条样本')).toBeInTheDocument()

    // 切「羽化应用」：只留 e1，计数与 aria-pressed 同步。
    fireEvent.click(screen.getByTestId('sample-review-filter-eclosion'))
    expect(screen.getByTestId('sample-review-filter-eclosion')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('sample-review-filter-all')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1 条样本')).toBeInTheDocument()

    // 切回全部。
    fireEvent.click(screen.getByTestId('sample-review-filter-all'))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the empty hint when the filter matches nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      okGet([
        {
          id: 's1',
          text: '只有动态面板样本',
          classification: 'ok',
          createdAt: '2026-09-28T15:18:21.227Z',
        },
      ]),
    )
    render(<SampleReviewSection />)
    await waitFor(() => expect(screen.getByTestId('sample-review-list')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('sample-review-filter-eclosion'))
    await waitFor(() => expect(screen.getByTestId('sample-review-filter-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('sample-review-list')).toBeNull()
  })
})
