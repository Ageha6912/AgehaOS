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
 * W6（审计 .tmp/spaces-audit.md §9）：条目增可选 `onKeyUp`——registry 同时
 * 挂 keyup(capture) 分发，**仅分发给 test 命中且带 onKeyUp 的条目**（向后
 * 兼容：不传 onKeyUp 的既有条目对 keyup 零感知，行为零变化）。
 *
 * IME 守卫（2026-11 审查）：keydown 分配发前统一过 isImeComposing——组合期
 * Esc 是取消候选词，不能被 search.close 等条目消费；keyup 不拦（Alt 松开
 * 提交仍需工作）。
 */

import { isImeComposing } from '@/components/ime-guard'

export interface ShortcutEntry {
  id: string
  /** 守卫（每次按键实时求值）：返回 false 时跳过该条目、继续下一条。 */
  when?: () => boolean
  test: (event: KeyboardEvent) => boolean
  run: (event: KeyboardEvent) => void
  /**
   * W6 可选 keyup 处理器（Window Switcher 的「松开提交」三段交互）：keyup
   * 分发按注册序找首个 when 通过 + test 命中且带本字段的条目执行后停止；
   * 未携带的条目不消费 keyup（零感知）。
   */
  onKeyUp?: (event: KeyboardEvent) => void
}

const entries: ShortcutEntry[] = []
let keydownHandler: ((event: KeyboardEvent) => void) | null = null
let keyupHandler: ((event: KeyboardEvent) => void) | null = null

/** 注册条目（追加到有序表尾），返回注销函数。 */
export function registerShortcut(entry: ShortcutEntry): () => void {
  entries.push(entry)
  return () => {
    const index = entries.indexOf(entry)
    if (index !== -1) entries.splice(index, 1)
  }
}

/** 挂载 window keydown/keyup(capture) 分发器；幂等。返回 detach（测试/卸载用）。 */
export function mountShortcutRegistry(): () => void {
  if (keydownHandler) return () => {}
  keydownHandler = (event) => {
    // 组合期按键属于 IME（Esc 取消候选词等），shell 快捷键一律让位。
    if (isImeComposing(event)) return
    for (const entry of entries) {
      if (entry.when && !entry.when()) continue
      if (!entry.test(event)) continue
      entry.run(event)
      break // 首个命中即停止：后续条目不参与本次按键
    }
  }
  // W6 keyup 分发（审计 §9）：仅命中 test 且带 onKeyUp 的条目——没带 onKeyUp
  // 的条目不消费 keyup（不停止分发），不传的既有条目零感知。
  keyupHandler = (event) => {
    for (const entry of entries) {
      if (entry.when && !entry.when()) continue
      if (!entry.test(event)) continue
      if (!entry.onKeyUp) continue
      entry.onKeyUp(event)
      break // 首个命中即停止
    }
  }
  window.addEventListener('keydown', keydownHandler, true)
  window.addEventListener('keyup', keyupHandler, true)
  return () => {
    if (!keydownHandler || !keyupHandler) return
    window.removeEventListener('keydown', keydownHandler, true)
    window.removeEventListener('keyup', keyupHandler, true)
    keydownHandler = null
    keyupHandler = null
  }
}

/** 测试隔离出口：清空条目并摘除分发器。 */
export function resetShortcutRegistry(): void {
  entries.length = 0
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler, true)
    keydownHandler = null
  }
  if (keyupHandler) {
    window.removeEventListener('keyup', keyupHandler, true)
    keyupHandler = null
  }
}
