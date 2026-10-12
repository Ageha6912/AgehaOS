export type WindowState = 'normal' | 'minimized' | 'maximized'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowInstance {
  id: string
  appId: string
  title: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  state: WindowState
  focused: boolean
  resizable: boolean
  closable: boolean
  minWidth: number
  minHeight: number
  restoreBounds: WindowBounds | null
  /** 归属 Space（W2，审计 .tmp/spaces-audit.md §5）：引擎缺省落 DEFAULT_SPACE_ID。 */
  spaceId: string
}

export interface CreateWindowOptions {
  appId: string
  title: string
  x?: number
  y?: number
  width?: number
  height?: number
  resizable?: boolean
  closable?: boolean
  minWidth?: number
  minHeight?: number
  /** 目标 Space：缺省由 store 层 provider 注入当前 Space（审计 §5 决定 1）。 */
  spaceId?: string
}

export interface Viewport {
  width: number
  height: number
}
