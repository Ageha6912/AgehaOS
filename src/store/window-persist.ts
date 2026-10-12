import type { WindowBounds, WindowState } from '@/core/window'

/**
 * 窗口持久化 schema（Window Management 2.0 W2，审计 .tmp/spaces-audit.md §5
 * 决定 2）：手写 localStorage（key `agehaos.spaces.windows.v1`，照
 * workspace-store 范式）的纯 schema 校验/序列化层——零 store 依赖，可独立
 * 单测。设备本地存储，不进云端同步（同 workspace/space 口径）。
 */

export const WINDOWS_STORAGE_KEY = 'agehaos.spaces.windows.v1'

/** 持久化条目 = WindowInstance 的几何/状态/归属子集（focused 等运行时字段不落盘）。 */
export interface PersistedWindow {
  id: string
  appId: string
  title: string
  x: number
  y: number
  width: number
  height: number
  state: WindowState
  spaceId: string
  restoreBounds: WindowBounds | null
  zIndex: number
}

export interface PersistedWindows {
  version: 1
  windows: PersistedWindow[]
}

export function serializeWindows(windows: PersistedWindow[]): string {
  return JSON.stringify({ version: 1, windows } satisfies PersistedWindows)
}

/** 读原始 localStorage 文本 → JSON.parse；损坏（非 JSON）返回 null。 */
export function readPersistedWindowsText(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(WINDOWS_STORAGE_KEY)
}

/**
 * 结构校验：version 不符或任一条目字段缺失/类型不对 → 整体 null（审计
 * §5 决定 2「version/结构损坏整体丢弃」）。条目级过滤（appId 无 manifest、
 * spaceId 失联）是语义校验，归 window-store 的 hydrate，不在此层。
 */
export function parsePersistedWindows(data: unknown): PersistedWindow[] | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  if (record.version !== 1) return null
  if (!Array.isArray(record.windows)) return null

  const windows: PersistedWindow[] = []
  for (const entry of record.windows) {
    const win = parseWindow(entry)
    if (!win) return null
    windows.push(win)
  }
  return windows
}

export function parsePersistedWindowsText(text: string | null): PersistedWindow[] | null {
  if (text === null) return null
  try {
    return parsePersistedWindows(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

const WINDOW_STATES: readonly WindowState[] = ['normal', 'minimized', 'maximized']

function parseWindow(value: unknown): PersistedWindow | null {
  if (typeof value !== 'object' || value === null) return null
  const win = value as Record<string, unknown>
  for (const key of ['id', 'appId', 'title', 'spaceId'] as const) {
    if (typeof win[key] !== 'string') return null
  }
  for (const key of ['x', 'y', 'width', 'height', 'zIndex'] as const) {
    if (typeof win[key] !== 'number' || !Number.isFinite(win[key])) return null
  }
  if (!WINDOW_STATES.includes(win.state as WindowState)) return null
  const restoreBounds = parseRestoreBounds(win.restoreBounds)
  if (restoreBounds === undefined) return null
  return {
    id: win.id as string,
    appId: win.appId as string,
    title: win.title as string,
    x: win.x as number,
    y: win.y as number,
    width: win.width as number,
    height: win.height as number,
    state: win.state as WindowState,
    spaceId: win.spaceId as string,
    restoreBounds,
    zIndex: win.zIndex as number,
  }
}

/** null = 合法缺省（无恢复界）；undefined = 结构损坏（整条目拒绝）。 */
function parseRestoreBounds(value: unknown): WindowBounds | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const bounds = value as Record<string, unknown>
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof bounds[key] !== 'number' || !Number.isFinite(bounds[key])) return undefined
  }
  return {
    x: bounds.x as number,
    y: bounds.y as number,
    width: bounds.width as number,
    height: bounds.height as number,
  }
}
