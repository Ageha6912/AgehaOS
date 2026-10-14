import { create } from 'zustand'

import { systemBus } from '@/core/events'
import {
  DEFAULT_SPACE_ID,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WindowManager,
} from '@/core/window'
import type { CreateWindowOptions, SnapBand, Viewport, WindowInstance } from '@/core/window'
import { getAppManifest } from '@/store/app-store'

import {
  WINDOWS_STORAGE_KEY,
  parsePersistedWindowsText,
  readPersistedWindowsText,
  serializeWindows,
  type PersistedWindow,
} from './window-persist'

interface WindowStoreState {
  windows: WindowInstance[]
  open: (options: CreateWindowOptions) => string
  close: (id: string) => void
  focus: (id: string) => void
  minimize: (id: string) => void
  toggleMaximize: (id: string) => void
  restore: (id: string) => void
  move: (id: string, x: number, y: number, viewport?: Viewport) => void
  resize: (id: string, width: number, height: number, viewport?: Viewport) => void
  setTitle: (id: string, title: string) => void
  moveWindowToSpace: (id: string, spaceId: string) => void
  /** W4 Window Snap（审计 .tmp/spaces-audit.md §7）：透传 + commit。 */
  snap: (id: string, dir: 'left' | 'right', band: SnapBand) => void
  unsnap: (id: string) => void
}

let engine = new WindowManager(systemBus)

/**
 * Space 归属 provider 注入（W2，审计 .tmp/spaces-audit.md §5 决定 1）：
 * window-store **禁止 import space-store**（无环依赖铁律），「新窗进当前
 * Space」的缺省值与「目标 Space 存在性」由 space-store 模块装配时反向注册
 * （依赖方向只有 space-store→window-store 单向）；缺省实现纯兜底——
 * 归属落 DEFAULT_SPACE_ID、存在性放行（引擎侧只弱校验非空字符串）。
 */
let getSpaceId: () => string = () => DEFAULT_SPACE_ID
let spaceExists: (spaceId: string) => boolean = () => true

export function setWindowSpaceIdProvider(fn: () => string): void {
  getSpaceId = fn
}

export function setWindowSpaceExistsProvider(fn: (spaceId: string) => boolean): void {
  spaceExists = fn
}

/** 每次 commit 后静默 persist（审计 §5 决定 2；写失败静默降级）。 */
function commit(): void {
  const windows = engine.list()
  useWindowStore.setState({ windows })
  persistWindows(windows)
}

function toPersistedWindow(win: WindowInstance): PersistedWindow {
  return {
    id: win.id,
    appId: win.appId,
    title: win.title,
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
    state: win.state,
    spaceId: win.spaceId,
    restoreBounds: win.restoreBounds ? { ...win.restoreBounds } : null,
    // W4（审计 §7）：可选字段随写——旧版本读端缺字段回落 null/'normal'。
    snapMode: win.snapMode,
    restoreState: win.restoreState,
    zIndex: win.zIndex,
  }
}

function persistWindows(windows: WindowInstance[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(WINDOWS_STORAGE_KEY, serializeWindows(windows.map(toPersistedWindow)))
  } catch {
    /* quota or privacy mode: windows stay in memory */
  }
}

/** 持久化条目 → 完整 WindowInstance：schema 外的运行时字段回落出厂缺省。 */
function toWindowInstance(entry: PersistedWindow): WindowInstance {
  return {
    ...entry,
    // W4（审计 §7）：旧载荷缺可选字段 → snapMode=null、restoreState='normal'
    // （前向兼容，不清桌面）。
    snapMode: entry.snapMode ?? null,
    restoreState: entry.restoreState ?? 'normal',
    focused: false,
    resizable: true,
    closable: true,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
  }
}

export const useWindowStore = create<WindowStoreState>()(() => {
  return {
    windows: [],

    open: (options) => {
      // 缺省归属走 provider（space-store 注册「当前 Space」）；显式 spaceId 透传。
      const win = engine.create({ ...options, spaceId: options.spaceId ?? getSpaceId() })
      commit()
      return win.id
    },

    close: (id) => {
      engine.close(id)
      commit()
    },

    focus: (id) => {
      engine.focus(id)
      commit()
    },

    minimize: (id) => {
      engine.minimize(id)
      commit()
    },

    toggleMaximize: (id) => {
      const win = engine.get(id)
      if (!win) return
      if (win.state === 'maximized') engine.restore(id)
      else engine.maximize(id)
      commit()
    },

    restore: (id) => {
      engine.restore(id)
      commit()
    },

    move: (id, x, y, viewport) => {
      engine.move(id, x, y, viewport)
      commit()
    },

    resize: (id, width, height, viewport) => {
      engine.resize(id, width, height, viewport)
      commit()
    },

    setTitle: (id, title) => {
      engine.setTitle(id, title)
      commit()
    },

    // 审计 §5 决定 3：目标 Space 不存在 no-op（存在性经 provider 校验）；
    // 引擎成功后 commit+persist，window.space-assigned 事件由引擎广播，
    // zIndex/focused 均不动（跨 Space 不抢焦点）。
    moveWindowToSpace: (id, spaceId) => {
      if (!spaceExists(spaceId)) return
      if (engine.moveWindowToSpace(id, spaceId)) commit()
    },

    // W4 Window Snap（审计 §7）：action 透传 + commit+persist；band 由调用方
    // （WindowFrame）传入，store 层零 DOM。
    snap: (id, dir, band) => {
      if (engine.snap(id, dir, band)) commit()
    },

    unsnap: (id) => {
      if (engine.unsnap(id)) commit()
    },
  }
})

/**
 * 窗口持久化恢复（W2 行为变更「刷新恢复现场」，审计 §5 决定 2）：**不在
 * 模块加载期做**——由 Desktop.tsx 挂载 effect 显式调用（先 reloadSpaceStore()
 * 再本函数）；移动 Shell 不调用 → 移动「刷新即清空」零变化（M1-6 红线）。
 * 守卫=仅当当前 windows 为空（设备翻转 Desktop 重挂不重复灌入）。
 * 规则：version/结构损坏整体丢弃；appId 无 manifest 丢弃；spaceId 不在
 * 当前 Space 列表丢弃（防御）；恢复后 focused 全 false，对 active Space 内
 * zIndex 最大者 focus()（引擎 topZ 已重置为 max(zIndex)，focus 保持单调）。
 */
export function hydratePersistedWindows(): void {
  if (useWindowStore.getState().windows.length > 0) return
  const persisted = parsePersistedWindowsText(readPersistedWindowsText())
  if (!persisted) return
  const activeSpaceId = getSpaceId()
  const valid = persisted
    .filter((entry) => getAppManifest(entry.appId) !== null)
    .filter((entry) => spaceExists(entry.spaceId))
  if (valid.length === 0) return

  engine.hydrateWindows(valid.map(toWindowInstance))
  const stack = engine.list().filter((win) => win.spaceId === activeSpaceId)
  const top = stack[stack.length - 1]
  if (top) engine.focus(top.id)
  commit()
}

/** Replaces the engine with a fresh one; used between tests. */
export function resetWindowStore(): void {
  engine = new WindowManager(systemBus)
  useWindowStore.setState({ windows: [] })
}
