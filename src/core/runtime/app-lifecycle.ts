import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

export interface AppLifecycleTracker {
  /** Starts listening; safe to call repeatedly. */
  start(): void
  /** Detaches from the bus; the tracker can be restarted afterwards. */
  stop(): void
  isRunning(appId: string): boolean
  runningAppIds(): string[]
}

type LifecycleBus = Pick<EventBus<SystemEventMap>, 'on' | 'off' | 'emit'>

/**
 * Derives per-app running state from window events (PRD §25): an app is
 * running while at least one of its windows exists, and `app.started` /
 * `app.stopped` fire on the 0→1 and 1→0 transitions.
 */
export function createAppLifecycleTracker(bus: LifecycleBus): AppLifecycleTracker {
  const windowCounts = new Map<string, number>()
  let detachCreated: (() => void) | null = null
  let detachClosed: (() => void) | null = null

  return {
    start() {
      if (detachCreated || detachClosed) return
      detachCreated = bus.on('window.created', ({ appId, windowId }) => {
        const next = (windowCounts.get(appId) ?? 0) + 1
        windowCounts.set(appId, next)
        if (next === 1) bus.emit('app.started', { appId, windowId })
      })
      detachClosed = bus.on('window.closed', ({ appId, windowId }) => {
        const next = (windowCounts.get(appId) ?? 1) - 1
        if (next <= 0) {
          windowCounts.delete(appId)
          bus.emit('app.stopped', { appId, windowId })
          return
        }
        windowCounts.set(appId, next)
      })
    },

    stop() {
      detachCreated?.()
      detachClosed?.()
      detachCreated = null
      detachClosed = null
    },

    isRunning: (appId) => windowCounts.has(appId),

    runningAppIds: () => [...windowCounts.keys()],
  }
}

/** Process-level lifecycle tracker; started explicitly at boot (main.tsx). */
export const systemAppLifecycle = createAppLifecycleTracker(systemBus)
