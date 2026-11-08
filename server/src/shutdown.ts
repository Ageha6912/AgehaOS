/**
 * 优雅停机（A1 审查轻微项）：SIGINT/SIGTERM → app.close() → 退出。
 *
 * 旧实现 `app.close().then(() => process.exit(0))` 有两个缺口——close 拒绝
 * （store.close 抛错等）时变成 unhandled rejection 且进程不退出，SIGTERM
 * 无法停机；重复信号会对 closing 实例二次 close。这里统一收口：
 * 只处理首个信号、成功 exit(0)、失败打日志后 exit(1)。
 */

export interface ShutdownApp {
  close: () => Promise<void>
}

export interface ShutdownHooks {
  /** 注册信号处理器（缺省 process.on）。 */
  register: (signal: string, handler: () => void) => void
  /** 结束进程（缺省 process.exit）。 */
  exit: (code: number) => void
}

export function registerShutdown(app: ShutdownApp, hooks?: Partial<ShutdownHooks>): void {
  const register =
    hooks?.register ??
    ((signal: string, handler: () => void) => process.on(signal as NodeJS.Signals, handler))
  const exit = hooks?.exit ?? ((code: number) => process.exit(code))
  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    void app.close().then(
      () => exit(0),
      (error: unknown) => {
        console.error('[agehaos-server] graceful shutdown failed', error)
        exit(1)
      },
    )
  }
  register('SIGINT', stop)
  register('SIGTERM', stop)
}
