import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'

import { resetWindowStore, useWindowStore } from './window-store'
import { reloadSpaceStore, resetSpaceStore, useSpaceStore } from './space-store'

const STORAGE_KEY = 'agehaos.spaces.v1'

beforeEach(() => {
  localStorage.clear()
  resetWindowStore()
  resetSpaceStore()
})

describe('useSpaceStore（Space 列表持久化，W1）', () => {
  it('引导态：无持久化数据时恰好一个 "Desktop 1" 且 active', () => {
    const { spaces, activeSpaceId } = useSpaceStore.getState()

    expect(spaces).toHaveLength(1)
    expect(spaces[0]).toMatchObject({ id: DEFAULT_SPACE_ID, name: 'Desktop 1', index: 0 })
    expect(activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('createSpace 同步进 state 并落盘（agehaos.spaces.v1，version 1）', () => {
    const id = useSpaceStore.getState().createSpace('工作')

    const { spaces, activeSpaceId } = useSpaceStore.getState()
    expect(spaces.map((s) => s.id)).toEqual([DEFAULT_SPACE_ID, id])
    expect(activeSpaceId).toBe(DEFAULT_SPACE_ID)

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted).toMatchObject({ version: 1, activeSpaceId: DEFAULT_SPACE_ID })
    expect(persisted.spaces).toHaveLength(2)
  })

  it('deleteSpace 拒删最后一个 Space，state 与磁盘都保持', () => {
    useSpaceStore.getState().deleteSpace(DEFAULT_SPACE_ID)

    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).spaces).toHaveLength(1)
  })

  it('renameSpace 同步进 state 并落盘', () => {
    useSpaceStore.getState().renameSpace(DEFAULT_SPACE_ID, '工作')

    expect(useSpaceStore.getState().spaces[0]?.name).toBe('工作')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).spaces[0]?.name).toBe('工作')
  })

  it('switchSpace 更新 activeSpaceId 并落盘；reorderSpaces 重排 index 并落盘', () => {
    const { createSpace, switchSpace, reorderSpaces } = useSpaceStore.getState()
    const second = createSpace('工作')
    switchSpace(second)
    reorderSpaces(DEFAULT_SPACE_ID, 1)

    const { spaces, activeSpaceId } = useSpaceStore.getState()
    expect(activeSpaceId).toBe(second)
    expect(spaces.map((s) => s.id)).toEqual([second, DEFAULT_SPACE_ID])
    expect(spaces.map((s) => s.index)).toEqual([0, 1])

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.activeSpaceId).toBe(second)
  })

  it('reloadSpaceStore 从持久化数据恢复（刷新后保持）', () => {
    const { createSpace, switchSpace } = useSpaceStore.getState()
    const second = createSpace('工作')
    switchSpace(second)

    // 模拟新页面加载：内存态先归位（只重置内存，磁盘持久化保留）再重读。
    useSpaceStore.setState({ spaces: [], activeSpaceId: DEFAULT_SPACE_ID })
    reloadSpaceStore()

    const { spaces, activeSpaceId } = useSpaceStore.getState()
    expect(spaces.map((s) => s.name)).toEqual(['Desktop 1', '工作'])
    expect(activeSpaceId).toBe(second)
  })

  it('损坏持久化数据回落引导态（corrupt JSON / version 不符）', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    reloadSpaceStore()
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().spaces[0]?.id).toBe(DEFAULT_SPACE_ID)

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, spaces: [], activeSpaceId: 'x' }))
    reloadSpaceStore()
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('resetSpaceStore 清空磁盘与内存，回到引导态', () => {
    useSpaceStore.getState().createSpace('工作')
    resetSpaceStore()

    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('useSpaceStore.setActiveWindow（W3，审计 .tmp/spaces-audit.md §6）', () => {
  it('记忆随 mutation 进 state 并落盘（agehaos.spaces.v1 携带 activeWindowId）', () => {
    const workId = useSpaceStore.getState().createSpace('工作')
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    useSpaceStore.getState().setActiveWindow(workId, winId)

    expect(useSpaceStore.getState().spaces.find((space) => space.id === workId)?.activeWindowId).toBe(winId)
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.spaces.find((space: { id: string }) => space.id === workId).activeWindowId).toBe(winId)
  })

  it('悬空 windowId 置 null（窗口已关/不存在时不落悬空引用）', () => {
    useSpaceStore.getState().setActiveWindow(DEFAULT_SPACE_ID, 'ghost-window')

    expect(useSpaceStore.getState().spaces[0]?.activeWindowId).toBeNull()
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(persisted.spaces[0].activeWindowId).toBeNull()
  })

  it('Space 不存在拒：不崩、state 与磁盘不变', () => {
    const before = useSpaceStore.getState().spaces

    useSpaceStore.getState().setActiveWindow('missing', null)

    expect(useSpaceStore.getState().spaces).toEqual(before)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).spaces).toHaveLength(1)
  })

  it('reloadSpaceStore round-trip 保留 activeWindowId（刷新恢复记忆）', () => {
    const workId = useSpaceStore.getState().createSpace('工作')
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useSpaceStore.getState().setActiveWindow(workId, winId)

    useSpaceStore.setState({ spaces: [], activeSpaceId: DEFAULT_SPACE_ID })
    reloadSpaceStore()

    expect(useSpaceStore.getState().spaces.find((space) => space.id === workId)?.activeWindowId).toBe(winId)
  })
})

describe('space-store × 窗口归属（W2，审计 .tmp/spaces-audit.md §5 决定 1）', () => {
  it('isEmpty 真实计数：非空 Space 拒删，空 Space 可删', () => {
    const workId = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', spaceId: workId })

    // 非空拒删：state 与磁盘都保持两个 Space。
    useSpaceStore.getState().deleteSpace(workId)
    expect(useSpaceStore.getState().spaces.map((s) => s.id)).toEqual([DEFAULT_SPACE_ID, workId])

    // 窗口关闭后变空：可删。
    const win = useWindowStore.getState().windows[0]!
    useWindowStore.getState().close(win.id)
    useSpaceStore.getState().deleteSpace(workId)
    expect(useSpaceStore.getState().spaces.map((s) => s.id)).toEqual([DEFAULT_SPACE_ID])
  })

  it('provider 接线：open() 缺省落当前 active Space（新窗进当前 Space）', () => {
    const workId = useSpaceStore.getState().createSpace('工作')
    useSpaceStore.getState().switchSpace(workId)

    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    expect(useWindowStore.getState().windows[0]?.spaceId).toBe(workId)
  })

  it('resetSpaceStore 重建引擎后 provider 自动跟随（闭包读模块级 engine 绑定）', () => {
    const workId = useSpaceStore.getState().createSpace('工作')
    useSpaceStore.getState().switchSpace(workId)

    resetSpaceStore()
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)

    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    expect(useWindowStore.getState().windows[0]?.spaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('deleteSpace 拒删时 window-store 零感知：窗口照常存活', () => {
    const workId = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', spaceId: workId })

    useSpaceStore.getState().deleteSpace(workId)

    expect(useWindowStore.getState().windows).toHaveLength(1)
  })
})

describe('space-store 模块加载期引导（全新页面语义）', () => {
  it('冷启动从 localStorage 恢复 Space 列表与 active 选择', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        spaces: [
          { id: DEFAULT_SPACE_ID, name: 'Desktop 1', index: 0, createdAt: 1000, updatedAt: 1000 },
          { id: 'space-x', name: '工作', index: 1, createdAt: 1000, updatedAt: 1000 },
        ],
        activeSpaceId: 'space-x',
      }),
    )
    vi.resetModules()
    const fresh = await import('./space-store')

    const { spaces, activeSpaceId } = fresh.useSpaceStore.getState()
    expect(spaces.map((s) => s.id)).toEqual([DEFAULT_SPACE_ID, 'space-x'])
    expect(activeSpaceId).toBe('space-x')
  })

  it('冷启动遇损坏数据回落引导态（恰好一个 Desktop 1）', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('./space-store')

    const { spaces, activeSpaceId } = fresh.useSpaceStore.getState()
    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.id).toBe(DEFAULT_SPACE_ID)
    expect(activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })
})
