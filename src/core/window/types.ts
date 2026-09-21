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
}

export interface Viewport {
  width: number
  height: number
}
