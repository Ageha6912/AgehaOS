import type { EventBus, SystemEventMap } from '@/core/events'

import type { CreateWindowOptions, Viewport, WindowInstance } from './types'
import { DEFAULT_SPACE_ID } from './space-types'
import { calculateSnapGeometry } from './snap'
import type { SnapBand, SnapDirection } from './snap'

export const DEFAULT_WINDOW_WIDTH = 900
export const DEFAULT_WINDOW_HEIGHT = 600
export const MIN_WINDOW_WIDTH = 320
export const MIN_WINDOW_HEIGHT = 200

/** Minimum of a window (px) that must stay inside the viewport when moving. */
export const MIN_VISIBLE_EDGE = 80

/** Upper bound for window titles (SDK setTitle 与系统启动路径共用)。 */
export const MAX_TITLE_LENGTH = 120

// 176 = 左侧 system-rails 液态玻璃组的右缘（16+150）+10px：单栏拉长后
// 级联起点若留在 80，新窗口左缘整条压在 z-40 玻璃轨下，应用内左侧控件
// 全部无法点击（2026-10-03 用户裁决「单栏拉长」的连带位移）。
const CASCADE_BASE = 176
const CASCADE_STEP = 32
const CASCADE_CYCLE = 8

export type WindowEventBus = Pick<EventBus<SystemEventMap>, 'emit'>

/**
 * Window lifecycle and geometry, framework-agnostic (PRD §7).
 *
 * `focus()` never un-minimizes a window — the taskbar composes
 * `restore()` + `focus()` for that.
 */
export class WindowManager {
  private windows = new Map<string, WindowInstance>()
  private topZ = 0
  private createdCount = 0

  constructor(
    private bus: WindowEventBus,
    private generateId: () => string = () => crypto.randomUUID(),
  ) {}

  create(options: CreateWindowOptions): WindowInstance {
    const id = this.generateId()
    const offset = (this.createdCount++ % CASCADE_CYCLE) * CASCADE_STEP
    const minWidth = options.minWidth ?? MIN_WINDOW_WIDTH
    const minHeight = options.minHeight ?? MIN_WINDOW_HEIGHT
    const instance: WindowInstance = {
      id,
      appId: options.appId,
      title: options.title,
      x: options.x ?? CASCADE_BASE + offset,
      y: options.y ?? CASCADE_BASE + offset,
      width: Math.max(options.width ?? DEFAULT_WINDOW_WIDTH, minWidth),
      height: Math.max(options.height ?? DEFAULT_WINDOW_HEIGHT, minHeight),
      zIndex: this.nextZ(),
      state: 'normal',
      focused: false,
      resizable: options.resizable ?? true,
      closable: options.closable ?? true,
      minWidth,
      minHeight,
      restoreBounds: null,
      // W4 Window Snap（审计 §7）：出厂即非吸附、落点记忆 normal。
      snapMode: null,
      restoreState: 'normal',
      // W2 窗口归属（审计 §5 决定 1）：这里只落 DEFAULT_SPACE_ID 纯兜底；
      // 真实缺省（当前 Space）由 store 层 provider 注入后经 options.spaceId 传入。
      spaceId: options.spaceId ?? DEFAULT_SPACE_ID,
    }
    this.windows.set(id, instance)
    for (const win of this.windows.values()) {
      win.focused = win.id === id
    }
    this.bus.emit('window.created', { windowId: id, appId: instance.appId })
    this.bus.emit('window.focused', { windowId: id })
    return this.get(id)!
  }

  focus(id: string): boolean {
    const target = this.windows.get(id)
    if (!target || target.state === 'minimized') return false
    for (const win of this.windows.values()) {
      win.focused = win.id === id
    }
    target.zIndex = this.nextZ()
    this.bus.emit('window.focused', { windowId: id })
    return true
  }

  close(id: string): boolean {
    const target = this.windows.get(id)
    if (!target || !this.windows.delete(id)) return false
    this.bus.emit('window.closed', { windowId: id, appId: target.appId })
    this.focusTopmost()
    return true
  }

  minimize(id: string): boolean {
    const target = this.windows.get(id)
    if (!target || target.state === 'minimized') return false
    const wasFocused = target.focused
    // W4 restore 矩阵（审计 §7）：minimize 时按当时状态记忆还原落点——
    // 'maximized'/'snapped'/'normal' 三者原样记录，restore() 据此分派。
    target.restoreState = target.state
    target.state = 'minimized'
    target.focused = false
    this.bus.emit('window.minimized', { windowId: id })
    if (wasFocused) this.focusTopmost()
    return true
  }

  maximize(id: string): boolean {
    const target = this.windows.get(id)
    if (!target || target.state === 'maximized') return false
    if (target.state === 'normal') {
      target.restoreBounds = {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
      }
      target.restoreState = 'normal'
    } else if (target.state === 'snapped') {
      // W4（审计 §7）：snapped maximize 时几何原地保留——maximized 渲染走
      // inset-0 不读 x/y；restoreBounds 保持 snap 时记录的原 normal 几何
      // （供之后 restore 落回 snapped 再 unsnap 回最初几何），restoreState
      // 记 'snapped' 使 restore() 分派回 snapped 原几何。
      target.restoreState = 'snapped'
    }
    target.state = 'maximized'
    this.bus.emit('window.maximized', { windowId: id })
    this.focus(id)
    return true
  }

  restore(id: string): boolean {
    const target = this.windows.get(id)
    if (!target) return false

    if (target.state === 'minimized') {
      // W4 restore 矩阵（审计 §7）：按 minimize 时记忆的 restoreState 分派。
      if (target.restoreState === 'maximized') {
        target.state = 'maximized'
      } else if (target.restoreState === 'snapped') {
        target.state = 'snapped'
        target.restoreState = 'normal'
      } else {
        target.state = 'normal'
        target.restoreState = 'normal'
      }
      this.bus.emit('window.restored', { windowId: id })
      this.focus(id)
      return true
    }

    if (target.state === 'maximized') {
      // W4（审计 §7）：restoreState='snapped' → 落回 snapped（几何即保留值，
      // restoreBounds 保留供 unsnap）；否则走既有 restoreBounds normal 回落。
      if (target.restoreState === 'snapped') {
        target.state = 'snapped'
        target.restoreState = 'normal'
        this.bus.emit('window.restored', { windowId: id })
        this.focus(id)
        return true
      }
      if (target.restoreBounds) {
        const bounds = target.restoreBounds
        target.x = bounds.x
        target.y = bounds.y
        target.width = bounds.width
        target.height = bounds.height
        target.restoreBounds = null
        target.state = 'normal'
        target.restoreState = 'normal'
        this.bus.emit('window.restored', { windowId: id })
        this.focus(id)
        return true
      }
    }

    return false
  }

  /**
   * W4 Window Snap（审计 .tmp/spaces-audit.md §7）：吸附到工作区带左/右半屏。
   * band 由调用方传入（引擎零 DOM，见 snap.ts 注释）；仅 normal 态放行，
   * maximized/snapped 拒绝（snapped 重吸附须先 unsnap）。记 restoreState=
   * 'normal'、restoreBounds=当前几何、几何=calculateSnapGeometry、state=
   * 'snapped'、snapMode=dir；成功广播 window.snapped。
   */
  snap(id: string, dir: SnapDirection, band: SnapBand): boolean {
    const target = this.windows.get(id)
    if (!target || target.state !== 'normal') return false
    target.restoreState = 'normal'
    target.restoreBounds = {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    }
    const bounds = calculateSnapGeometry(dir, band)
    target.x = bounds.x
    target.y = bounds.y
    target.width = bounds.width
    target.height = bounds.height
    target.state = 'snapped'
    target.snapMode = dir
    this.bus.emit('window.snapped', { windowId: id, snapMode: dir })
    return true
  }

  /**
   * W4（审计 §7）：仅 snapped 态放行；几何回 restoreBounds、清三字段
   * （restoreBounds/snapMode/restoreState）；广播 window.unsnapped。拖出
   * 脱 snap 的「组合层转换点」在 WindowFrame（onTitlePointerDown 先 unsnap），
   * 引擎 move/resize 对 snapped 保持拒绝（守卫语义不变，矩阵钉扎）。
   */
  unsnap(id: string): boolean {
    const target = this.windows.get(id)
    if (!target || target.state !== 'snapped') return false
    // 正常流转下 snapped 驻留态 restoreBounds 恒有值（snap() 记录）；null
    // 只可能来自脏持久化数据——就地脱 snap（几何保留）而非永久卡死。
    if (target.restoreBounds) {
      const bounds = target.restoreBounds
      target.x = bounds.x
      target.y = bounds.y
      target.width = bounds.width
      target.height = bounds.height
    }
    target.restoreBounds = null
    target.snapMode = null
    target.restoreState = 'normal'
    target.state = 'normal'
    this.bus.emit('window.unsnapped', { windowId: id })
    return true
  }

  move(id: string, x: number, y: number, viewport?: Viewport): boolean {
    const target = this.windows.get(id)
    if (!target || target.state !== 'normal') return false
    const minX = viewport ? MIN_VISIBLE_EDGE - target.width : Number.NEGATIVE_INFINITY
    const maxX = viewport ? viewport.width - MIN_VISIBLE_EDGE : Number.POSITIVE_INFINITY
    const maxY = viewport ? viewport.height - MIN_VISIBLE_EDGE : Number.POSITIVE_INFINITY
    target.x = clamp(x, minX, maxX)
    target.y = clamp(y, 0, maxY)
    return true
  }

  resize(id: string, width: number, height: number, viewport?: Viewport): boolean {
    const target = this.windows.get(id)
    if (!target || !target.resizable || target.state !== 'normal') return false
    const maxWidth = viewport ? viewport.width - target.x : Number.POSITIVE_INFINITY
    const maxHeight = viewport ? viewport.height - target.y : Number.POSITIVE_INFINITY
    target.width = clamp(width, target.minWidth, maxWidth)
    target.height = clamp(height, target.minHeight, maxHeight)
    return true
  }

  /**
   * W2 窗口归属（审计 .tmp/spaces-audit.md §5 决定 3）：把窗口改派到另一
   * Space。引擎只弱校验 spaceId 非空字符串（目标 Space 的存在性由 store
   * 层校验后调用）；zIndex 与焦点不动（跨 Space 不抢焦点）。同 Space
   * 重复指派视为 no-op 拒绝（对齐 switchSpace/minimize 的既有口径，不发
   * 多余事件）；成功广播 window.space-assigned。
   */
  moveWindowToSpace(id: string, spaceId: string): boolean {
    const target = this.windows.get(id)
    if (!target) return false
    if (typeof spaceId !== 'string' || spaceId === '') return false
    if (target.spaceId === spaceId) return false
    const fromSpaceId = target.spaceId
    target.spaceId = spaceId
    this.bus.emit('window.space-assigned', { windowId: id, fromSpaceId, toSpaceId: spaceId })
    return true
  }

  /**
   * W2 窗口持久化恢复（审计 §5 决定 2）：整批灌入已由 store 层校验过的
   * 窗口（覆盖 id/zIndex/几何/归属），topZ 重置为 max(zIndex) 保单调；
   * focused 一律落 false（焦点由 store 层对 active Space 栈顶补 focus）。
   * 恢复是加载行为不是用户 mutation，不广播任何事件。
   */
  hydrateWindows(windows: WindowInstance[]): void {
    this.windows = new Map(windows.map((win) => [win.id, cloneWindow({ ...win, focused: false })]))
    this.topZ = windows.reduce((max, win) => Math.max(max, win.zIndex), 0)
    this.createdCount = windows.length
  }

  /** SDK Window API：应用更新自己窗口的标题（空标题与超长标题被拒绝）。 */
  setTitle(id: string, title: string): boolean {
    const target = this.windows.get(id)
    if (!target) return false
    const trimmed = typeof title === 'string' ? title.trim() : ''
    if (trimmed === '' || trimmed.length > MAX_TITLE_LENGTH) return false
    target.title = trimmed
    return true
  }

  get(id: string): WindowInstance | null {
    const win = this.windows.get(id)
    return win ? cloneWindow(win) : null
  }

  /** All windows sorted by z-order, ascending. */
  list(): WindowInstance[] {
    return [...this.windows.values()].sort((a, b) => a.zIndex - b.zIndex).map(cloneWindow)
  }

  visibleList(): WindowInstance[] {
    return this.list().filter((win) => win.state !== 'minimized')
  }

  get count(): number {
    return this.windows.size
  }

  private nextZ(): number {
    this.topZ += 1
    return this.topZ
  }

  private focusTopmost(): boolean {
    let best: WindowInstance | null = null
    for (const win of this.windows.values()) {
      if (win.state === 'minimized') continue
      if (!best || win.zIndex > best.zIndex) best = win
    }
    return best ? this.focus(best.id) : false
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function cloneWindow(win: WindowInstance): WindowInstance {
  return {
    ...win,
    restoreBounds: win.restoreBounds ? { ...win.restoreBounds } : null,
  }
}
