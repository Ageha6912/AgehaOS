import { create } from 'zustand'

/**
 * 应用用量统计（Phase 2 P2-5，DESIGN.md §22）：设备本地的「最近使用」，
 * 为启动器 Recent 区供数据。与动作偏好同口径——设备行为不进云同步。
 * 上限 8 条、按 appId 去重（最新在前）；只记用户主动启动（launchApp
 * source='user'），系统自动开窗（动态面板/小游戏轮换）不记。
 */

const STORAGE_KEY = 'agehaos.usage.recent.v1'
export const RECENT_LIMIT = 8

export interface RecentEntry {
  appId: string
  at: number
}

interface UsageState {
  recent: RecentEntry[]
  recordRecentApp: (appId: string) => void
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as { appId?: unknown; at?: unknown }
  return typeof entry.appId === 'string' && typeof entry.at === 'number'
}

function loadPersisted(): RecentEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentEntry).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

function persist(recent: RecentEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent))
  } catch {
    /* quota or privacy mode: usage stays in memory */
  }
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  recent: loadPersisted(),

  recordRecentApp: (appId) => {
    const recent = [
      { appId, at: Date.now() },
      ...get().recent.filter((entry) => entry.appId !== appId),
    ].slice(0, RECENT_LIMIT)
    persist(recent)
    set({ recent })
  },

}))

/** 测试间隔离（localStorage 由测试自清）。 */
export function resetUsageStore(): void {
  useUsageStore.setState({ recent: [] })
}
