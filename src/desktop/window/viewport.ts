import type { Viewport } from '@/core/window'

/** Matches the taskbar height (h-12 = 48px at the default 16px root font). */
export const TASKBAR_HEIGHT_PX = 48

export function getWorkspaceViewport(): Viewport {
  return {
    width: window.innerWidth,
    height: Math.max(window.innerHeight - TASKBAR_HEIGHT_PX, 0),
  }
}
