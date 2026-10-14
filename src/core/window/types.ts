/** W4 Window Snap（审计 .tmp/spaces-audit.md §7）：'snapped' 加入状态机。 */
export type WindowState = 'normal' | 'minimized' | 'maximized' | 'snapped'

/** restoreState 记忆「离开 maximized/minimized 后的落点」（审计 §7）。 */
export type WindowRestoreState = 'normal' | 'snapped' | 'maximized'

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
  /**
   * W4 Window Snap（审计 §7）：吸附方向（左右半屏）；null=非 snapped 态。
   * 引擎 snap(id, dir, band) 只在 normal 态放行，snapped 重吸附须先 unsnap。
   */
  snapMode: 'left' | 'right' | null
  /** 离开 maximized/minimized 后的落点记忆（审计 §7 restore 矩阵分派依据）。 */
  restoreState: WindowRestoreState
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
