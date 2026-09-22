import type { EventBus, SystemEventMap } from '@/core/events'

import type { CreateWindowOptions, Viewport, WindowInstance } from './types'

export const DEFAULT_WINDOW_WIDTH = 900
export const DEFAULT_WINDOW_HEIGHT = 600
export const MIN_WINDOW_WIDTH = 320
export const MIN_WINDOW_HEIGHT = 200

/** Minimum of a window (px) that must stay inside the viewport when moving. */
export const MIN_VISIBLE_EDGE = 80

const CASCADE_BASE = 80
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
      target.state = target.restoreBounds ? 'maximized' : 'normal'
      this.bus.emit('window.restored', { windowId: id })
      this.focus(id)
      return true
    }

    if (target.state === 'maximized' && target.restoreBounds) {
      const bounds = target.restoreBounds
      target.x = bounds.x
      target.y = bounds.y
      target.width = bounds.width
      target.height = bounds.height
      target.restoreBounds = null
      target.state = 'normal'
      this.bus.emit('window.restored', { windowId: id })
      this.focus(id)
      return true
    }

    return false
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
