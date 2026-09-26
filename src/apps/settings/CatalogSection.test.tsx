import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CatalogSection } from './CatalogSection'

const fetchMock = vi.fn()

function okGet(apps: unknown[]): Response {
  return { ok: true, status: 200, json: async () => ({ apps }) } as Response
}

function okPut(): Response {
  return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
}

const SAMPLE_APP = {
  id: 'com.ageha.samples.counter',
  name: '计数器',
  version: '1.0.0',
  entry: '/apps/sites/counter/index.html',
  permissions: [],
  window: { width: 320, height: 280, resizable: true },
  author: 'AgehaOS Samples',
  description: '远程目录发布示例：经签名目录安装的零权限计数器。',
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('CatalogSection (ADR 20 远程目录管理)', () => {
  it('lists the published catalog entries', async () => {
    fetchMock.mockResolvedValueOnce(okGet([SAMPLE_APP]))
    render(<CatalogSection />)

    await waitFor(() => {
      expect(screen.getByTestId('catalog-list')).toBeInTheDocument()
    })
    expect(screen.getByText('计数器')).toBeInTheDocument()
    expect(screen.getByText(/com\.ageha\.samples\.counter/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/store/admin/catalog', { credentials: 'same-origin' })
  })

  it('shows the empty hint when nothing is published', async () => {
    fetchMock.mockResolvedValueOnce(okGet([]))
    render(<CatalogSection />)
    await waitFor(() => {
      expect(screen.getByText('尚未发布应用。')).toBeInTheDocument()
    })
  })

  it('publishes a JSON entry via PUT and clears the textarea on success', async () => {
    fetchMock.mockResolvedValueOnce(okGet([])).mockResolvedValueOnce(okPut())
    render(<CatalogSection />)
    await waitFor(() => {
      expect(screen.getByText('尚未发布应用。')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('发布应用（JSON）'), {
      target: { value: JSON.stringify(SAMPLE_APP) },
    })
    fireEvent.click(screen.getByRole('button', { name: '发布应用（JSON）' }))

    await waitFor(() => {
      expect(screen.getByText('已发布')).toBeInTheDocument()
    })
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === 'PUT')
    expect(put?.[0]).toBe('/api/store/admin/catalog')
    const body = JSON.parse((put?.[1]?.body as string) ?? '{}') as { apps: unknown[] }
    expect(body.apps).toEqual([SAMPLE_APP])
    expect(screen.getByLabelText('发布应用（JSON）')).toHaveValue('')
  })

  it('reports a parse error without touching the network', async () => {
    fetchMock.mockResolvedValueOnce(okGet([]))
    render(<CatalogSection />)
    await waitFor(() => {
      expect(screen.getByText('尚未发布应用。')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('发布应用（JSON）'), { target: { value: '{oops' } })
    fireEvent.click(screen.getByRole('button', { name: '发布应用（JSON）' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('JSON 解析失败')
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(0)
  })

  it('surfaces server rejection and keeps the draft', async () => {
    fetchMock
      .mockResolvedValueOnce(okGet([]))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'invalid-catalog' }) } as Response)
    render(<CatalogSection />)
    await waitFor(() => {
      expect(screen.getByText('尚未发布应用。')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('发布应用（JSON）'), {
      target: { value: JSON.stringify(SAMPLE_APP) },
    })
    fireEvent.click(screen.getByRole('button', { name: '发布应用（JSON）' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('发布被拒绝')
    expect(screen.getByLabelText('发布应用（JSON）')).not.toHaveValue('')
  })

  it('removes an entry by publishing the remainder', async () => {
    fetchMock.mockResolvedValueOnce(okGet([SAMPLE_APP])).mockResolvedValueOnce(okPut())
    render(<CatalogSection />)
    await waitFor(() => {
      expect(screen.getByText('计数器')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '移除 计数器' }))

    await waitFor(() => {
      expect(screen.getByText('已发布')).toBeInTheDocument()
    })
    const put = fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT').pop()
    const body = JSON.parse((put?.[1]?.body as string) ?? 'null') as { apps: unknown[] } | null
    expect(body?.apps).toEqual([])
  })
})
