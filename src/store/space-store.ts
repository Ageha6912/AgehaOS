import { create } from 'zustand'

import { systemBus } from '@/core/events'
import { SpaceManager } from '@/core/window'
import type { PersistedSpaces, Space } from '@/core/window'
import {
  setWindowSpaceExistsProvider,
  setWindowSpaceIdProvider,
  useWindowStore,
} from './window-store'
import type { WorkspaceId } from './workspace-store'

/**
 * Ageha Spaces store（Window Management 2.0 W1，审计 .tmp/spaces-audit.md §2）：
 * zustand 包 SpaceManager 单例（镜像 window-store 形态）+ `agehaos.spaces.v1`
 * 手写 localStorage 持久化——逐条照抄 workspace-store 范式：损坏回落引导态 /
 * 写失败静默降级（设备本地存储，不进云端同步，同 workspace 口径）。
 * W2（审计 §5）：窗口持久化在 window-store 侧（key `agehaos.spaces.windows.v1`）；
 * 本模块负责把「当前 Space」provider、「目标 Space 存在性」provider 与
 * 「非空 Space 拒删」isEmpty 谓词真实接线——依赖方向只有 space-store→
 * window-store 单向（window-store 禁止 import 本模块）。
 * W8（审计 §11）：增四档 Workspace↔Space 的 Primary 绑定表——**store 层
 * 私有状态，引擎不知情**；持久化 schema 以可选字段前向兼容扩展（version
 * 仍 1，载荷在引擎 `PersistedSpaces` 之上叠加 `workspaceBindings`）。
 */

const STORAGE_KEY = 'agehaos.spaces.v1'

/** 四档绑定类型：1 Workspace = 1 Primary Space（用户手建的第 5+ 个 Space 不参与映射）。 */
export type WorkspaceSpaceBindings = Partial<Record<WorkspaceId, string>>

/**
 * 四档 id 字面校验（W8 持久化损坏判定用）：本地镜像 `WORKSPACE_IDS`
 * （workspace-store.ts:14）——红线约束下对本模块只允许 WorkspaceId **类型**
 * 引用，运行时值（WORKSPACE_IDS/isWorkspaceId）不得 import，故此处内联。
 */
const WORKSPACE_BINDING_IDS: readonly string[] = ['personal', 'study', 'dev', 'creative']

/**
 * 持久化载荷 = 引擎 schema + 可选 bindings 字段（W8 前向兼容：旧载荷缺
 * 字段→空映射；字段损坏（非对象/值非字符串）→丢弃该字段不清 Space 列表；
 * version 仍 1，不 bump）。引擎层 `PersistedSpaces`（space-types.ts）零 diff。
 */
type PersistedSpacesPayload = PersistedSpaces & { workspaceBindings?: WorkspaceSpaceBindings }

interface SpaceStoreState {
  spaces: Space[]
  activeSpaceId: string
  /** 四档 Primary 绑定（W8）：值可能悬空（指向已删 Space），读取走 getBoundSpace 判活。 */
  workspaceBindings: WorkspaceSpaceBindings
  createSpace: (name?: string) => string
  deleteSpace: (id: string) => void
  renameSpace: (id: string, name: string) => void
  switchSpace: (id: string) => void
  reorderSpaces: (id: string, toIndex: number) => void
  setActiveWindow: (spaceId: string, windowId: string | null) => void
  bindWorkspace: (workspace: WorkspaceId, spaceId: string) => void
  getBoundSpace: (workspace: WorkspaceId) => string | null
}

function readPersisted(): unknown {
  if (typeof localStorage === 'undefined') return null
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    return null
  }
}

function persist(data: PersistedSpacesPayload): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* quota or privacy mode: spaces stay in memory */
  }
}

/**
 * 从持久化载荷提取 bindings（W8 前向兼容，审计 §11）：缺字段→空映射；
 * 字段损坏（非对象 / 键不是四档 WorkspaceId / 值非字符串）→丢弃该字段，
 * **不清 Space 列表**（Space 结构校验仍由引擎 hydrate 独立完成）。
 */
function parseWorkspaceBindings(data: unknown): WorkspaceSpaceBindings {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
  const raw = (data as { workspaceBindings?: unknown }).workspaceBindings
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const parsed: WorkspaceSpaceBindings = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!WORKSPACE_BINDING_IDS.includes(key) || typeof value !== 'string') return {}
    parsed[key as WorkspaceId] = value
  }
  return parsed
}

/**
 * 清空指向被删 Space 的绑定（W8，审计 §11：deleteSpace 的 store 层封装内做，
 * 引擎不知情）。
 */
function withoutBindingsFor(bindings: WorkspaceSpaceBindings, spaceId: string): WorkspaceSpaceBindings {
  const next: WorkspaceSpaceBindings = {}
  for (const [key, value] of Object.entries(bindings)) {
    if (value !== spaceId) next[key as WorkspaceId] = value
  }
  return next
}

function commit(): void {
  persist({ ...engine.snapshot(), workspaceBindings })
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
    workspaceBindings: { ...workspaceBindings },
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
function createEngine(data: unknown): SpaceManager {
  const manager = new SpaceManager(systemBus, undefined, isSpaceEmpty)
  manager.hydrate(data)
  return manager
}

const bootData = readPersisted()
let workspaceBindings = parseWorkspaceBindings(bootData)
let engine = createEngine(bootData)

// 模块装配期注册（审计 §5 决定 1）：闭包读模块级 `let engine` 绑定——
// reloadSpaceStore/resetSpaceStore 重建引擎后 provider 自动跟随，无需重注册。
setWindowSpaceIdProvider(() => engine.activeSpaceId)
setWindowSpaceExistsProvider((spaceId) =>
  engine.getSpaces().some((space) => space.id === spaceId),
)

export const useSpaceStore = create<SpaceStoreState>()(() => ({
  spaces: engine.getSpaces(),
  activeSpaceId: engine.activeSpaceId,
  workspaceBindings: { ...workspaceBindings },

  createSpace: (name) => {
    const space = engine.createSpace(name)
    commit()
    return space.id
  },

  deleteSpace: (id) => {
    const deleted = engine.deleteSpace(id)
    // W8（审计 §11）：删除成功才清空指向被删 Space 的 bindings（拒删时
    // 绑定与 Space 同保持）；引擎不知道绑定表，清理只在 store 层。
    if (deleted) workspaceBindings = withoutBindingsFor(workspaceBindings, id)
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

  // W3（审计 .tmp/spaces-audit.md §6）：active window 按 Space 记忆。悬空
  // windowId 置 null——引擎不知道窗口，存在性判定在 store 层（读
  // useWindowStore，单向依赖）；成功不广播新事件（焦点真相已有
  // window.focused）。每次 mutation 照旧 persist（activeWindowId 随快照落盘）。
  setActiveWindow: (spaceId, windowId) => {
    const live =
      windowId !== null &&
      useWindowStore.getState().windows.some((win) => win.id === windowId)
    engine.setActiveWindow(spaceId, live ? windowId : null)
    commit()
  },

  // W8（审计 §11）：四档 Primary 绑定——store 层私有，引擎零感知；写入后
  // 照常 commit 持久化（workspaceBindings 随载荷落盘，version 仍 1）。
  bindWorkspace: (workspace, spaceId) => {
    workspaceBindings = { ...workspaceBindings, [workspace]: spaceId }
    commit()
  },

  // 绑定不存在或指向死 id（Space 已被删/未恢复）都返回 null——悬空绑定
  // 由 space-binding 的播种回落处理（评审建议 7），此处只如实判活。
  getBoundSpace: (workspace) => {
    const bound = workspaceBindings[workspace]
    if (bound === undefined) return null
    return engine.getSpaces().some((space) => space.id === bound) ? bound : null
  },
}))

/** 模拟新页面加载：保留持久化数据重读（区别于 wipe 语义的 reset）。 */
export function reloadSpaceStore(): void {
  const data = readPersisted()
  engine = createEngine(data)
  workspaceBindings = parseWorkspaceBindings(data)
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
    workspaceBindings: { ...workspaceBindings },
  })
}

/** 测试隔离出口。 */
export function resetSpaceStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  workspaceBindings = {}
  engine = new SpaceManager(systemBus, undefined, isSpaceEmpty)
  useSpaceStore.setState({
    spaces: engine.getSpaces(),
    activeSpaceId: engine.activeSpaceId,
    workspaceBindings: {},
  })
}
