import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isRemoteAuthActive, setAuthProvider } from '@/core/auth'
import { createVfs, MemoryAdapter } from '@/core/filesystem'
import type { Vfs } from '@/core/filesystem'
import { hashContent as hashContentOf } from '@/core/sync/file-merge'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import {
  applySnapshot,
  pullFilesOnce,
  resetFileSyncStateForTests,
  syncNow,
  serializeTree,
  startFileSync,
} from './file-sync'
import { setSyncEnabled } from './settings-sync'

vi.mock('@/core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, isRemoteAuthActive: vi.fn(() => false) }
})

const fetchMock = vi.fn()

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function makeUser() {
  return {
    id: 'u1',
    username: 'alice',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  }
}

async function makeVfs(): Promise<Vfs> {
  const vfs = createVfs({ adapter: new MemoryAdapter() })
  await vfs.ready()
  return vfs
}

/** 等待微任务队列排空（vfs 操作链）。 */


beforeEach(async () => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  resetFileSyncStateForTests()
  resetSessionStore()
  resetNotificationStore()
  setSyncEnabled(false)
  vi.mocked(isRemoteAuthActive).mockReturnValue(true)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  seedSessionForTests(makeUser())
})

afterEach(() => {
  setAuthProvider(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('file-sync snapshot helpers (PRD §35 Phase 3 文本切片)', () => {
  it('serializes the local tree as a v2 tree with per-file hashes', async () => {
    const vfs = await makeVfs()
    await vfs.writeFile('/Documents/notes.txt', 'hello')

    const tree = await serializeTree(vfs)

    expect(tree.dirs).toContain('/Documents')
    expect(tree.files['/Documents/notes.txt']?.content).toBe('hello')
    expect(tree.files['/Documents/notes.txt']?.hash).toBeTruthy()
  })

  it('applies a snapshot: creates dirs/files, updates changed, culls extraneous', async () => {
    const vfs = await makeVfs()
    await vfs.writeFile('/Documents/local-only.txt', 'obsolete')
    await vfs.writeFile('/Documents/keep.txt', 'stale')
    // 根级系统目录受保护不可删（PRD §11.1）：内容被清空，外壳保留。
    await vfs.writeFile('/Videos/local-video.txt', 'obsolete')

    await applySnapshot(vfs, {
      version: 1,
      savedAt: 1000,
      tree: {
        dirs: ['/Documents', '/Documents/deep'],
        files: [
          { path: '/Documents/keep.txt', content: 'fresh' },
          { path: '/Documents/deep/cloud.txt', content: 'from cloud' },
        ],
      },
    })

    await expect(vfs.readFile('/Documents/keep.txt')).resolves.toBe('fresh')
    await expect(vfs.readFile('/Documents/deep/cloud.txt')).resolves.toBe('from cloud')
    await expect(vfs.readFile('/Documents/local-only.txt')).rejects.toMatchObject({ code: 'not-found' })
    await expect(vfs.readFile('/Videos/local-video.txt')).rejects.toMatchObject({ code: 'not-found' })
    await expect(vfs.get('/Videos')).resolves.not.toBeNull()
  })
})

describe('file-sync service (PRD §35 Phase 3 文本切片)', () => {
  it('does nothing when sync is disabled or auth is local', async () => {
    const vfs = await makeVfs()
    startFileSync({ vfs })

    // 本地认证：即使开关开着（含开关事件触发的立即拉取）也不产生请求。
    vi.mocked(isRemoteAuthActive).mockReturnValue(false)
    setSyncEnabled(true)
    await vi.advanceTimersByTimeAsync(50)
    await pullFilesOnce()
    expect(fetchMock).not.toHaveBeenCalled()

    // 远程认证但开关关闭：同样不产生请求。
    vi.mocked(isRemoteAuthActive).mockReturnValue(true)
    setSyncEnabled(false)
    await pullFilesOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies a newer server snapshot on pull without echoing a push (LWW 服务端赢)', async () => {
    const vfs = await makeVfs()
    startFileSync({ vfs })
    setSyncEnabled(true)
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: JSON.stringify({
          version: 1,
          savedAt: 2000,
          tree: { dirs: ['/Documents'], files: [{ path: '/Documents/cloud.txt', content: 'cloud' }] },
        }),
      }),
    )

    await pullFilesOnce()

    await expect(vfs.readFile('/Documents/cloud.txt')).resolves.toBe('cloud')
    expect(localStorage.getItem('agehaos.file-sync.v1.u1')).toContain('"lastSyncedAt":2000')
    // 回声防护：应用期间触发的 file.* 事件不得上推。
    await vi.advanceTimersByTimeAsync(3000)
    const puts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT')
    expect(puts).toHaveLength(0)
  })

  it('skips the pull when the server snapshot is not newer than the marker (LWW 本地保留)', async () => {
    const vfs = await makeVfs()
    localStorage.setItem('agehaos.file-sync.v1.u1', JSON.stringify({ lastSyncedAt: 5000 }))
    startFileSync({ vfs })
    setSyncEnabled(true)
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: JSON.stringify({
          version: 1,
          savedAt: 4000,
          tree: { dirs: [], files: [{ path: '/Documents/old.txt', content: 'old' }] },
        }),
      }),
    )

    await pullFilesOnce()

    await expect(vfs.get('/Documents/old.txt')).resolves.toBeNull()
  })

  it('pushes the local tree when the server has no snapshot yet (首次上传)', async () => {
    const vfs = await makeVfs()
    await vfs.writeFile('/Documents/seed.txt', 'local-first')
    startFileSync({ vfs })
    setSyncEnabled(true)
    fetchMock.mockResolvedValue(jsonResponse({ data: null }))

    await pullFilesOnce()
    await vi.advanceTimersByTimeAsync(1600)


    const put = fetchMock.mock.calls.find((call) => call[1]?.method === 'PUT')
    expect(put?.[0]).toBe('/api/sync/data/files')
    const body = JSON.parse((put?.[1]?.body as string) ?? '{}') as { data: string }
    expect(body.data).toContain('seed.txt')
    expect(localStorage.getItem('agehaos.file-sync.v1.u1')).not.toBeNull()
  })

  it('debounces file events into a single push (变更推，本地赢)', async () => {
    const vfs = await makeVfs()
    startFileSync({ vfs })
    setSyncEnabled(true)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await vfs.writeFile('/Documents/a.txt', 'one')
    await vi.advanceTimersByTimeAsync(800)
    await vfs.writeFile('/Documents/a.txt', 'two')
    await vi.advanceTimersByTimeAsync(1600)


    const puts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT')
    expect(puts).toHaveLength(1)
    const body = JSON.parse((puts[0]?.[1]?.body as string) ?? '{}') as { data: string }
    expect(body.data).toContain('"two"')
    // 同内容不重推。
    await vfs.writeFile('/Documents/b.txt', 'x')
    await vi.advanceTimersByTimeAsync(1600)

    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(2)
  })

  it('skips oversized snapshots and notifies once (体积守门)', async () => {
    const vfs = await makeVfs()
    startFileSync({ vfs })
    setSyncEnabled(true)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await vfs.writeFile('/Documents/big.txt', 'x'.repeat(256 * 1024 + 1))
    await vi.advanceTimersByTimeAsync(1600)


    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(0)
    const entries = useNotificationStore.getState().items
    expect(entries.some((entry) => entry.titleKey === 'notification.title.fileSyncOversized')).toBe(true)

    // 同会话内第二次超快照不再重复通知。
    await vfs.writeFile('/Documents/big2.txt', 'y'.repeat(256 * 1024 + 1))
    await vi.advanceTimersByTimeAsync(1600)

    expect(useNotificationStore.getState().items.filter((e) => e.titleKey === 'notification.title.fileSyncOversized')).toHaveLength(1)
  })
})

describe('file-sync toggle reaction (会话中途开启)', () => {
  it('pulls immediately when the sync toggle is turned on mid-session', async () => {
    const vfs = await makeVfs()
    startFileSync({ vfs })
    // 开关关闭期间服务端已有较新快照。
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: JSON.stringify({
          version: 1,
          savedAt: 3000,
          tree: { dirs: ['/Documents'], files: [{ path: '/Documents/late.txt', content: 'late' }] },
        }),
      }),
    )

    setSyncEnabled(true)

    await vi.advanceTimersByTimeAsync(50)
    await expect(vfs.readFile('/Documents/late.txt')).resolves.toBe('late')
    expect(fetchMock).toHaveBeenCalledWith('/api/sync/data/files', expect.anything())
  })
})

describe('file-sync three-way merge (PRD §35 Phase 3，ADR 17)', () => {
  const hashContent = (content: string): string => hashContentOf(content)

  async function seedBase(): Promise<Vfs> {
    const vfs = await makeVfs()
    await vfs.writeFile('/Documents/a.txt', 'a-base')
    await vfs.writeFile('/Documents/b.txt', 'b-base')
    startFileSync({ vfs })
    setSyncEnabled(true)
    // 首次同步：服务端为空 → 上传初始树并记录 v2 基线。
    fetchMock.mockResolvedValue(jsonResponse({ data: null }))
    await pullFilesOnce()
    await vi.advanceTimersByTimeAsync(1600)
    return vfs
  }

  const serverBlob = (files: Record<string, string>, savedAt = 5000): Response =>
    jsonResponse({
      data: JSON.stringify({
        version: 2,
        savedAt,
        dirs: ['/Documents'],
        files: Object.fromEntries(
          Object.entries(files).map(([path, content]) => [path, { hash: hashContent(content), content }]),
        ),
      }),
    })

  const lastPut = (): { data: string } => {
    const put = fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT').pop()
    return JSON.parse((put?.[1]?.body as string) ?? '{}') as { data: string }
  }

  it('applies the server change locally while uploading the local change (双向不冲突)', async () => {
    const vfs = await seedBase()
    await vfs.writeFile('/Documents/a.txt', 'a-local')
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(serverBlob({ '/Documents/a.txt': 'a-base', '/Documents/b.txt': 'b-server' }))

    await syncNow()

    await expect(vfs.readFile('/Documents/b.txt')).resolves.toBe('b-server')
    const merged = JSON.parse(lastPut().data) as { files: Record<string, { content: string }> }
    expect(merged.files['/Documents/a.txt']?.content).toBe('a-local')
    expect(merged.files['/Documents/b.txt']?.content).toBe('b-server')
  })

  it('creates a conflict copy on concurrent edits of the same file (不丢数据)', async () => {
    const vfs = await seedBase()
    await vfs.writeFile('/Documents/a.txt', 'local edit')
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(serverBlob({ '/Documents/a.txt': 'server edit' }))

    await syncNow()

    // 本地版本原地保留。
    await expect(vfs.readFile('/Documents/a.txt')).resolves.toBe('local edit')
    // 服务端版本另存冲突副本。
    const entries = await vfs.list('/Documents')
    const conflict = entries.find((entry) => entry.name.includes('.conflict-'))
    expect(conflict, 'conflict copy should exist').toBeTruthy()
    await expect(vfs.readFile(`/Documents/${conflict?.name}`)).resolves.toBe('server edit')
    // 合并树上两者都上传。
    const merged = JSON.parse(lastPut().data) as { files: Record<string, { content: string }> }
    expect(merged.files['/Documents/a.txt']?.content).toBe('local edit')
    expect(Object.keys(merged.files).some((path) => path.includes('.conflict-'))).toBe(true)
  })

  it('propagates a server deletion of an untouched local file', async () => {
    const vfs = await seedBase()
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(serverBlob({ '/Documents/a.txt': 'a-base' }))

    await syncNow()

    await expect(vfs.get('/Documents/b.txt')).resolves.toBeNull()
    const merged = JSON.parse(lastPut().data) as { files: Record<string, unknown> }
    expect(merged.files['/Documents/b.txt']).toBeUndefined()
  })
})
