import { create } from 'zustand'

import { systemBus } from '@/core/events'
import { SpaceManager } from '@/core/window'
import type { Space } from '@/core/window'
import {
  setWindowSpaceExistsProvider,
  setWindowSpaceIdProvider,
  useWindowStore,
} from './window-store'

/**
 * Ageha Spaces store（Window Management 2.0 W1，审计 .tmp/spaces-audit.md §2）：
 * zustand 包 SpaceManager 单例（镜像 window-store 形态）+ `agehaos.spaces.v1`
 * 手写 localStorage 持久化——逐条照抄 workspace-store 范式：损坏回落引导态 /
 * 写失败静默降级（设备本地存储，不进云端同步，同 workspace 口径）。
 * W2（审计 §5）：窗口持久化在 window-store 侧（key `agehaos.spaces.windows.v1`）；
 * 本模块负责把「当前 Space」provider、「目标 Space 存在性」provider 与
 * 「非空 Space 拒删」isEmpty 谓词真实接线——依赖方向只有 space-store→
 * window-store 单向（window-store 禁止 import 本模块）。
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

/**
 * 「非空 Space 拒删」真实计数（审计 §5 决定 1）：该 Space 下无窗口才算空。
 * 读 useWindowStore 单向依赖；W1 的缺省恒真谓词由构造注入替换。
 */
function isSpaceEmpty(spaceId: string): boolean {
  return !useWindowStore.getState().windows.some((win) => win.spaceId === spaceId)
}

/** 引导 + 恢复：无持久化数据或数据损坏时 SpaceManager 回落引导态（恰好一个 Desktop 1）。 */
function createEngine(): SpaceManager {
  const manager = new SpaceManager(systemBus, undefined, isSpaceEmpty)
  manager.hydrate(readPersisted())
  return manager
}

let engine = createEngine()

// 模块装配期注册（审计 §5 决定 1）：闭包读模块级 `let engine` 绑定——
// reloadSpaceStore/resetSpaceStore 重建引擎后 provider 自动跟随，无需重注册。
setWindowSpaceIdProvider(() => engine.activeSpaceId)
setWindowSpaceExistsProvider((spaceId) =>
  engine.getSpaces().some((space) => space.id === spaceId),
)

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
  engine = new SpaceManager(systemBus, undefined, isSpaceEmpty)
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
  })
}
