import { create } from 'zustand'

import { systemBus } from '@/core/events'
import {
  DEFAULT_SPACE_ID,
  MIN_VISIBLE_EDGE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WindowManager,
} from '@/core/window'
import type { CreateWindowOptions, SnapBand, Viewport, WindowInstance } from '@/core/window'

import { getAppManifest } from './app-store'
import { systemSounds } from '@/services/sounds'

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

/**
 * 窗口实例的结构相等（除引用外逐字段）。commit 用它复用未变化窗口的旧
 * 引用——WindowFrame 是 memo 的，拖动一个窗口时其余窗口（及其应用子树）
 * 不再按指针频率重渲染（E1 审查）。
 */
function sameWindow(a: WindowInstance, b: WindowInstance): boolean {
  const sameBounds =
    a.restoreBounds === null
      ? b.restoreBounds === null
      : b.restoreBounds !== null &&
        a.restoreBounds.x === b.restoreBounds.x &&
        a.restoreBounds.y === b.restoreBounds.y &&
        a.restoreBounds.width === b.restoreBounds.width &&
        a.restoreBounds.height === b.restoreBounds.height
  return (
    a.id === b.id &&
    a.appId === b.appId &&
    a.title === b.title &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.state === b.state &&
    a.spaceId === b.spaceId &&
    a.zIndex === b.zIndex &&
    a.focused === b.focused &&
    a.snapMode === b.snapMode &&
    a.restoreState === b.restoreState &&
    a.resizable === b.resizable &&
    a.closable === b.closable &&
    a.minWidth === b.minWidth &&
    a.minHeight === b.minHeight &&
    sameBounds
  )
}

/** 每次 commit 后静默 persist（审计 §5 决定 2；写失败静默降级）。 */
function commit(): void {
  const windows = engine.list()
  const previous = useWindowStore.getState().windows
  const previousById = new Map(previous.map((win) => [win.id, win]))
  let changed = windows.length !== previous.length
  const reconciled = windows.map((win) => {
    const old = previousById.get(win.id)
    if (old !== undefined && sameWindow(old, win)) return old
    changed = true
    return win
  })
  if (changed) useWindowStore.setState({ windows: reconciled })
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

/**
 * 恢复几何钳制（C1 审查）：持久化的 x/y/width/height 原样灌入会让大屏保存
 * 的右缘窗口在窄屏刷新后完全在屏外，脏数据 0/负尺寸得到不可见窗口。按当前
 * 视口复用引擎的最小可见边规则（至少 MIN_VISIBLE_EDGE 可见），尺寸不小于
 * 引擎最小宽高；restoreBounds 同样处理，避免还原时再次飞出。
 */
function clampPersistedEntry(entry: PersistedWindow): PersistedWindow {
  const width = Math.max(MIN_WINDOW_WIDTH, entry.width)
  const height = Math.max(MIN_WINDOW_HEIGHT, entry.height)
  if (typeof window === 'undefined') return { ...entry, width, height }

  const maxX = window.innerWidth - MIN_VISIBLE_EDGE
  const maxY = window.innerHeight - MIN_VISIBLE_EDGE
  const clampX = (x: number, w: number): number =>
    Math.min(Math.max(x, MIN_VISIBLE_EDGE - w), maxX)
  const clampY = (y: number): number => Math.min(Math.max(y, 0), maxY)

  const restoreBounds = entry.restoreBounds
    ? {
        x: clampX(entry.restoreBounds.x, Math.max(MIN_WINDOW_WIDTH, entry.restoreBounds.width)),
        y: clampY(entry.restoreBounds.y),
        width: Math.max(MIN_WINDOW_WIDTH, entry.restoreBounds.width),
        height: Math.max(MIN_WINDOW_HEIGHT, entry.restoreBounds.height),
      }
    : null

  return {
    ...entry,
    x: clampX(entry.x, width),
    y: clampY(entry.y),
    width,
    height,
    restoreBounds,
  }
}

/** 持久化条目 → 完整 WindowInstance：schema 外的运行时字段回落出厂缺省。 */
function toWindowInstance(entry: PersistedWindow): WindowInstance {
  // manifest 约束回读（B2 审查）：旧实现硬编码 resizable:true——计算器等
  // 固定尺寸应用刷新恢复后重新出现缩放手柄/可双击最大化。
  const manifestWindow = getAppManifest(entry.appId)?.window
  return {
    ...entry,
    // W4（审计 §7）：旧载荷缺可选字段 → snapMode=null、restoreState='normal'
    // （前向兼容，不清桌面）。
    snapMode: entry.snapMode ?? null,
    restoreState: entry.restoreState ?? 'normal',
    focused: false,
    resizable: manifestWindow?.resizable ?? true,
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
    // （WindowFrame）传入，store 层零 DOM。吸附成功配一声软叩击（引擎拒绝=
    // 状态未变=无声，jsdom 无 AudioContext 时 sounds 静默）。
    snap: (id, dir, band) => {
      if (engine.snap(id, dir, band)) {
        commit()
        systemSounds.play('snap')
      }
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
 * 规则：version/结构损坏整体丢弃；spaceId 不在当前 Space 列表丢弃（防御）。
 * appId 暂未注册的窗口**保留**（渲染 MissingApp）——羽化 kept/今日世界是
 * 运行时异步注册，启动时按 manifest 过滤会在注册完成前把窗口永久丢掉并
 * commit 覆写存储。恢复后 focused 全 false，对 active Space 内 zIndex 最大者
 * focus()（引擎 topZ 已重置为 max(zIndex)，focus 保持单调）。
 */
export function hydratePersistedWindows(): void {
  if (useWindowStore.getState().windows.length > 0) return
  const persisted = parsePersistedWindowsText(readPersistedWindowsText())
  if (!persisted) return
  const activeSpaceId = getSpaceId()
  const valid = persisted.filter((entry) => spaceExists(entry.spaceId))
  if (valid.length === 0) return

  engine.hydrateWindows(valid.map(clampPersistedEntry).map(toWindowInstance))
  // 选活跃 Space 内 zIndex 最大的**非最小化**窗口（C1 审查：engine.focus
  // 拒绝最小化窗，旧实现选中它则恢复后无聚焦窗）；全最小化保持无焦点。
  const stack = engine.list().filter(
    (win) => win.spaceId === activeSpaceId && win.state !== 'minimized',
  )
  const top = stack[stack.length - 1]
  if (top) engine.focus(top.id)
  commit()
}

/** Replaces the engine with a fresh one; used between tests. */
export function resetWindowStore(): void {
  engine = new WindowManager(systemBus)
  useWindowStore.setState({ windows: [] })
}

// 应用卸载即关闭其全部窗口（B2 审查）：权限已撤，窗口不能以可操作状态
// 残留到下次启动。挂 engine 前订阅一次（模块级，与 systemBus 单例同生命周期）。
systemBus.on('app.uninstalled', ({ appId }) => {
  for (const win of useWindowStore.getState().windows) {
    if (win.appId === appId) useWindowStore.getState().close(win.id)
  }
})
