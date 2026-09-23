import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AI_PROXY_TIMEOUT_MS,
  filterAccepted,
  getCachedAiSlots,
  MAX_AI_ATTEMPTS_PER_SESSION,
  requestAiSlots,
  resetAiSessionState,
} from './client'

const INPUT = {
  locale: 'zh-CN' as const,
  context: { timePhase: 'day' },
  prefs: ['warm'],
  slots: ['tip'],
}

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response)
}

beforeEach(() => {
  resetAiSessionState()
})

describe('requestAiSlots (DDS §5.3 降级链客户端)', () => {
  it('posts aggregated features with a one-time anonymous id and caches the result', async () => {
    const fetchFn = okFetch({ items: [{ slotId: 'tip', text: 'pin' }] })
    const slots = await requestAiSlots(INPUT, { fetchFn })

    expect(slots).toEqual([{ slotId: 'tip', text: 'pin' }])
    expect(getCachedAiSlots()).toEqual(slots)
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    const body = JSON.parse(String(init.body)) as { anonymId: string; slots: string[] }
    expect(body.anonymId).toMatch(/^anon-/)
    expect(body.slots).toEqual(['tip'])
    expect(JSON.stringify(body)).not.toContain('userId')
  })

  it('applies the Phase B vocabulary gate: free text is dropped, not rendered', async () => {
    const fetchFn = okFetch({
      items: [
        { slotId: 'tip', text: '今天记得多喝水哦！' }, // 自由文本 → 丢弃
        { slotId: 'unknown-slot', text: 'pin' }, // 未知槽位 → 丢弃
        { slotId: 'tip', text: 'shortcut' }, // 词表内 → 保留
      ],
    })
    await expect(requestAiSlots(INPUT, { fetchFn })).resolves.toEqual([{ slotId: 'tip', text: 'shortcut' }])
  })

  it('treats an empty filtered result as failure', async () => {
    const fetchFn = okFetch({ items: [{ slotId: 'tip', text: '自由文案' }] })
    await expect(requestAiSlots(INPUT, { fetchFn })).rejects.toThrow('ai-empty-after-filter')
  })

  it('maps http failures and network errors to thrown errors', async () => {
    const httpError = vi.fn(async () => ({ ok: false, status: 503, json: async () => null }) as Response)
    await expect(requestAiSlots(INPUT, { fetchFn: httpError })).rejects.toThrow('ai-http-503')

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(requestAiSlots(INPUT, { fetchFn: offline })).rejects.toThrow('Failed to fetch')
  })

  it('aborts after the 2s budget (DDS §7.4)', async () => {
    const fetchFn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }) as Promise<Response>,
    ) as unknown as typeof fetch
    await expect(requestAiSlots(INPUT, { fetchFn, timeoutMs: 20 })).rejects.toThrow('aborted')
    expect(AI_PROXY_TIMEOUT_MS).toBe(2000)
  })

  it('caps attempts per session (first try + one retry, DDS §7.4)', async () => {
    const fetchFn = okFetch({ items: [{ slotId: 'tip', text: 'pin' }] })
    for (let attempt = 0; attempt < MAX_AI_ATTEMPTS_PER_SESSION; attempt += 1) {
      await requestAiSlots(INPUT, { fetchFn })
    }
    await expect(requestAiSlots(INPUT, { fetchFn })).rejects.toThrow('ai-session-exhausted')
  })
})

describe('filterAccepted', () => {
  it('drops malformed payloads of every shape', () => {
    expect(filterAccepted(null, ['tip'])).toEqual([])
    expect(filterAccepted({}, ['tip'])).toEqual([])
    expect(filterAccepted({ items: 'nope' }, ['tip'])).toEqual([])
    expect(filterAccepted({ items: [null, 42, { slotId: 1, text: 'pin' }] }, ['tip'])).toEqual([])
  })

  it('keeps the first item per slot and ignores everything outside the vocabulary', () => {
    const payload = {
      items: [
        ...Array.from({ length: 10 }, (_, index) => ({ slotId: `s${index}`, text: 'pin' })),
        { slotId: 'tip', text: 'privacy' },
        { slotId: 'tip', text: 'shortcut' },
      ],
    }
    const items = filterAccepted(payload, ['tip', ...Array.from({ length: 10 }, (_, i) => `s${i}`)])
    expect(items).toEqual([{ slotId: 'tip', text: 'privacy' }])
  })
})
