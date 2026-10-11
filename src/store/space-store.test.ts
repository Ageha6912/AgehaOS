import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'

import { reloadSpaceStore, resetSpaceStore, useSpaceStore } from './space-store'

const STORAGE_KEY = 'agehaos.spaces.v1'

beforeEach(() => {
  localStorage.clear()
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
