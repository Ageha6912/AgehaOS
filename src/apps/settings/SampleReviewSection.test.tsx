import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SampleReviewSection } from './SampleReviewSection'

const fetchMock = vi.fn()

function okGet(samples: unknown[]): Response {
  return { ok: true, status: 200, json: async () => ({ samples }) } as Response
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
    expect(fetchMock).toHaveBeenCalledWith('/api/dynamic/samples', { credentials: 'same-origin' })
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
})
