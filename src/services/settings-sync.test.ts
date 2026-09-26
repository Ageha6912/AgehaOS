import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isRemoteAuthActive, setAuthProvider } from '@/core/auth'
import { getLocale } from '@/core/i18n'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'

import { pullOnce, resetSyncStateForTests, setSyncEnabled, startSettingsSync } from './settings-sync'

vi.mock('@/core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, isRemoteAuthActive: vi.fn(() => false) }
})

const fetchMock = vi.fn()

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetSettingsStore()
  // reset 不覆盖 locale，显式归位。
  useSettingsStore.getState().setLocale('zh-CN')
  resetSyncStateForTests()
  setSyncEnabled(false)
  vi.mocked(isRemoteAuthActive).mockReturnValue(true)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // startSettingsSync 的订阅在模块内只装一次；确保每个用例拿到干净的 stub。
  startSettingsSync()
  await Promise.resolve()
})

afterEach(() => {
  setAuthProvider(null)
  vi.unstubAllGlobals()
})

describe('settings-sync service (PRD §35 用户配置同步)', () => {
  it('applies a server blob to the settings store on pull', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: JSON.stringify({ settings: { theme: 'dark', fontSize: 'large', locale: 'en' } }) }),
    )
    setSyncEnabled(true)

    await pullOnce()

    const settings = useSettingsStore.getState()
    expect(settings.theme).toBe('dark')
    expect(settings.fontSize).toBe('large')
    expect(getLocale()).toBe('en')
  })

  it('does nothing when sync is disabled or the blob is empty', async () => {
    await pullOnce()
    expect(fetchMock).not.toHaveBeenCalled()

    setSyncEnabled(true)
    fetchMock.mockResolvedValue(jsonResponse({ data: null }))
    await pullOnce()
    expect(useSettingsStore.getState().theme).toBe('light')
  })

  it('skips invalid values inside the blob', async () => {
    setSyncEnabled(true)
    fetchMock.mockResolvedValue(
      jsonResponse({ data: JSON.stringify({ settings: { theme: 'neon-pink', fontSize: 'huge', locale: 'klingon' } }) }),
    )

    await pullOnce()

    const settings = useSettingsStore.getState()
    expect(settings.theme).toBe('light')
    expect(settings.fontSize).toBe('medium')
    expect(getLocale()).toBe('zh-CN')
  })

  it('pushes debounced local changes with the echo guard', async () => {
    vi.useFakeTimers()
    try {
      startSettingsSync()
      setSyncEnabled(true)
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

      useSettingsStore.getState().setTheme('dark')
      await vi.advanceTimersByTimeAsync(1400)
      expect(fetchMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit
      expect(init.method).toBe('PUT')
      expect(JSON.parse(String(init.body)).data).toContain('"theme":"dark"')

      // 回声防护：同一内容不重复上推。
      useSettingsStore.getState().setTheme('light')
      await vi.advanceTimersByTimeAsync(1600)
      const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
      expect(JSON.parse(String(secondInit.body)).data).toContain('"theme":"light"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays silent when the backend is unreachable', async () => {
    setSyncEnabled(true)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(pullOnce()).resolves.toBeUndefined()
    expect(useSettingsStore.getState().theme).toBe('light')
  })
})
