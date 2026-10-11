import { create } from 'zustand'

import { systemBus } from '@/core/events'
import { SpaceManager } from '@/core/window'
import type { Space } from '@/core/window'

/**
 * Ageha Spaces store（Window Management 2.0 W1，审计 .tmp/spaces-audit.md §2）：
 * zustand 包 SpaceManager 单例（镜像 window-store 形态）+ `agehaos.spaces.v1`
 * 手写 localStorage 持久化——逐条照抄 workspace-store 范式：损坏回落引导态 /
 * 写失败静默降级（设备本地存储，不进云端同步，同 workspace 口径）。
 * 窗口持久化（key `agehaos.spaces.windows.v1`）是 W2 的事，此处不碰。
 */

const STORAGE_KEY = 'agehaos.spaces.v1'

interface SpaceStoreState {
  spaces: Space[]
  activeSpaceId: string
  createSpace: (name?: string) => string
  deleteSpace: (id: string) => void
  renameSpace: (id: string, name: string) => void
  switchSpace: (id: string) => void
  reorderSpaces: (id: string, toIndex: number) => void
}

function readPersisted(): unknown {
  if (typeof localStorage === 'undefined') return null
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    return null
  }
}

function persist(data: ReturnType<SpaceManager['snapshot']>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* quota or privacy mode: spaces stay in memory */
  }
}

function commit(): void {
  persist(engine.snapshot())
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
  })
}

/** 引导 + 恢复：无持久化数据或数据损坏时 SpaceManager 回落引导态（恰好一个 Desktop 1）。 */
function createEngine(): SpaceManager {
  const manager = new SpaceManager(systemBus)
  manager.hydrate(readPersisted())
  return manager
}

let engine = createEngine()

export const useSpaceStore = create<SpaceStoreState>()(() => ({
  spaces: engine.getSpaces(),
  activeSpaceId: engine.activeSpaceId,

  createSpace: (name) => {
    const space = engine.createSpace(name)
    commit()
    return space.id
  },

  deleteSpace: (id) => {
    engine.deleteSpace(id)
    commit()
  },

  renameSpace: (id, name) => {
    engine.renameSpace(id, name)
    commit()
  },

  switchSpace: (id) => {
    engine.switchSpace(id)
    commit()
  },

  reorderSpaces: (id, toIndex) => {
    engine.reorderSpaces(id, toIndex)
    commit()
  },
}))

/** 模拟新页面加载：保留持久化数据重读（区别于 wipe 语义的 reset）。 */
export function reloadSpaceStore(): void {
  engine = createEngine()
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
  })
}

/** 测试隔离出口。 */
export function resetSpaceStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  engine = new SpaceManager(systemBus)
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
  })
}
