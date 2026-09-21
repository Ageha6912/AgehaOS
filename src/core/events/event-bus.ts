export type EventHandler<P> = (payload: P) => void

export type BusErrorHandler = (error: unknown, eventName: string) => void

const defaultErrorHandler: BusErrorHandler = (error, eventName) => {
  console.error(`[AgehaOS:EventBus] handler for "${eventName}" threw`, error)
}

/**
 * Typed publish/subscribe bus.
 *
 * A throwing handler must never prevent other handlers from running:
 * each handler is isolated so a single failure cannot crash the desktop
 * (PRD §25 crash isolation).
 */
export class EventBus<M extends object> {
  private handlers = new Map<string, Set<EventHandler<never>>>()
  private errorHandler: BusErrorHandler = defaultErrorHandler

  setErrorHandler(handler: BusErrorHandler): void {
    this.errorHandler = handler
  }

  on<K extends keyof M & string>(eventName: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(eventName)
    if (!set) {
      set = new Set()
      this.handlers.set(eventName, set)
    }
    set.add(handler as EventHandler<never>)
    return () => this.off(eventName, handler)
  }

  once<K extends keyof M & string>(eventName: K, handler: EventHandler<M[K]>): () => void {
    const off = this.on(eventName, (payload) => {
      off()
      handler(payload)
    })
    return off
  }

  off<K extends keyof M & string>(eventName: K, handler: EventHandler<M[K]>): void {
    const set = this.handlers.get(eventName)
    if (!set) return
    set.delete(handler as EventHandler<never>)
    if (set.size === 0) this.handlers.delete(eventName)
  }

  emit<K extends keyof M & string>(eventName: K, payload: M[K]): void {
    const set = this.handlers.get(eventName)
    if (!set || set.size === 0) return
    for (const handler of [...set]) {
      try {
        ;(handler as EventHandler<M[K]>)(payload)
      } catch (error) {
        this.errorHandler(error, eventName)
      }
    }
  }

  listenerCount<K extends keyof M & string>(eventName: K): number {
    return this.handlers.get(eventName)?.size ?? 0
  }

  clear(): void {
    this.handlers.clear()
  }
}
