import { create } from 'zustand'

/**
 * 工作空间偏好（Desktop Shell 3.0 STEP 2 Workspace Panel）：设备本地存储，
 * 不进云端同步——与动作偏好/最近使用同口径（设备行为不进云同步）。本阶段
 * 只做 selector：不改窗口 workspace 几何，但选择真实影响启动器推荐/最近
 * 使用排序/今日世界建议的排序（src/desktop/workspace/affinity.ts），选择
 * 经 localStorage 持久化，刷新后保持。
 */

const STORAGE_KEY = 'agehaos.workspace.v1'

/** 四个工作空间（用户裁决口径：个人/学习/开发/创作）。 */
export const WORKSPACE_IDS = ['personal', 'study', 'dev', 'creative'] as const
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

export const DEFAULT_WORKSPACE: WorkspaceId = 'personal'

interface WorkspaceState {
  workspace: WorkspaceId
  setWorkspace: (workspace: WorkspaceId) => void
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && (WORKSPACE_IDS as readonly string[]).includes(value)
}

function load(): WorkspaceId {
  if (typeof localStorage === 'undefined') return DEFAULT_WORKSPACE
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return isWorkspaceId(parsed) ? parsed : DEFAULT_WORKSPACE
  } catch {
    return DEFAULT_WORKSPACE
  }
}

function persist(workspace: WorkspaceId): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
  } catch {
    /* quota or privacy mode: workspace stays in memory */
  }
}

const initial = load()

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  workspace: initial,
  setWorkspace: (workspace) => {
    persist(workspace)
    set({ workspace })
  },
}))

/** 模拟新页面加载：保留持久化数据重读（区别于 wipe 语义的 reset）。 */
export function reloadWorkspaceStore(): void {
  useWorkspaceStore.setState({ workspace: load() })
}

/** 测试隔离出口。 */
export function resetWorkspaceStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  useWorkspaceStore.setState({ workspace: DEFAULT_WORKSPACE })
}
