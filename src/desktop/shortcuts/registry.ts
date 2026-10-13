/**
 * 中央 shortcut registry（Window Management 2.0 W3，审计 .tmp/spaces-audit.md §6）。
 *
 * 设计：有序条目单实例 + 挂载一次 window keydown(**capture**)——capture 阶段
 * 在应用输入框聚焦时依然生效（shell 级快捷键，沿用 use-global-shortcuts 既有
 * 挂载语义）；按键分发按注册顺序逐条 `when` → `test`，**首个命中条目执行后
 * 停止**（互不抢键）。preventDefault 由条目自理（registry 不代按）。
 *
 * 条目注册/注销返回配对的 off 函数（React effect 清理友好）；挂载幂等——
 * 重复 mountShortcutRegistry() 返回 no-op detach，首个 detach 才真正摘除。
 * W6 挂点：Window Switcher 的按住/keyup 三段交互届时以向后兼容方式扩展条目
 * （不传 keyup 的既有条目零感知），本文件不预置。
 */

export interface ShortcutEntry {
  id: string
  /** 守卫（每次按键实时求值）：返回 false 时跳过该条目、继续下一条。 */
  when?: () => boolean
  test: (event: KeyboardEvent) => boolean
  run: (event: KeyboardEvent) => void
}

const entries: ShortcutEntry[] = []
let keydownHandler: ((event: KeyboardEvent) => void) | null = null

/** 注册条目（追加到有序表尾），返回注销函数。 */
export function registerShortcut(entry: ShortcutEntry): () => void {
  entries.push(entry)
  return () => {
    const index = entries.indexOf(entry)
    if (index !== -1) entries.splice(index, 1)
  }
}

/** 挂载 window keydown(capture) 分发器；幂等。返回 detach（测试/卸载用）。 */
export function mountShortcutRegistry(): () => void {
  if (keydownHandler) return () => {}
  keydownHandler = (event) => {
    for (const entry of entries) {
      if (entry.when && !entry.when()) continue
      if (!entry.test(event)) continue
      entry.run(event)
      break // 首个命中即停止：后续条目不参与本次按键
    }
  }
  window.addEventListener('keydown', keydownHandler, true)
  return () => {
    if (!keydownHandler) return
    window.removeEventListener('keydown', keydownHandler, true)
    keydownHandler = null
  }
}

/** 测试隔离出口：清空条目并摘除分发器。 */
export function resetShortcutRegistry(): void {
  entries.length = 0
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler, true)
    keydownHandler = null
  }
}
