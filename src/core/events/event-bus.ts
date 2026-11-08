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
  /** once 包装器映射（B1 审查：off(event, 原始 handler) 也能摘掉 once）。 */
  private onceWrappers = new WeakMap<EventHandler<never>, EventHandler<never>>()
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
    const wrapper = (payload: M[K]): void => {
      this.off(eventName, handler)
      handler(payload)
    }
    this.onceWrappers.set(handler as EventHandler<never>, wrapper as EventHandler<never>)
    return this.on(eventName, wrapper as EventHandler<M[K]>)
  }

  off<K extends keyof M & string>(eventName: K, handler: EventHandler<M[K]>): void {
    const set = this.handlers.get(eventName)
    if (!set) return
    // once 注册的监听器：用原始 handler 也能摘掉包装器。
    const wrapper = this.onceWrappers.get(handler as EventHandler<never>)
    if (wrapper !== undefined) {
      set.delete(wrapper)
      this.onceWrappers.delete(handler as EventHandler<never>)
    }
    set.delete(handler as EventHandler<never>)
    if (set.size === 0) this.handlers.delete(eventName)
  }

  emit<K extends keyof M & string>(eventName: K, payload: M[K]): void {
    const set = this.handlers.get(eventName)
    if (!set || set.size === 0) return
    for (const handler of [...set]) {
      // emit 期间被前面处理器 off 掉的监听器不再执行（B1 审查：快照迭代
      // 的语义修正——「首个事件里注销其它监听器」应真正生效）。
      if (!set.has(handler)) continue
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
