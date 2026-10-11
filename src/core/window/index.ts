export {
  WindowManager,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_VISIBLE_EDGE,
} from './window-manager'
export type { WindowEventBus } from './window-manager'
export type {
  WindowState,
  WindowBounds,
  WindowInstance,
  CreateWindowOptions,
  Viewport,
} from './types'
export {
  DEFAULT_SPACE_ID,
  MAX_SPACE_NAME_LENGTH,
  type Space,
  type PersistedSpaces,
} from './space-types'
export { SpaceManager } from './space-manager'
export type { SpaceEventBus } from './space-manager'
