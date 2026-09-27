/**
 * 关闭退场的 ghost 注册表（docs/DESIGN.md §12）。
 *
 * 关闭语义：store 立即提交（引擎/任务栏/启动逻辑立刻见到真相），退场视觉由
 * WindowLayer 里的 ghost 承载——同 key 的 WindowFrame 快照继续播完 120ms 退场，
 * aria-hidden + pointer-events-none（不进可达树、不截胡任何指针/定位器），
 * 飞行结束即卸载。没有它，延迟提交会让「将死窗口」在 store 里多活 120ms，
 * 与紧随其后的重开/定位产生 strict-mode 与旧 iframe 撞车（E2E 竞态根因）。
 */
import type { WindowInstance } from '@/core/window'

interface GhostEntry {
  win: WindowInstance
  /** 硬兜底定时器：动画终局事件丢失时也能清除。 */
  bailout: number
}

let ghosts: GhostEntry[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 关闭即登记：快照先行于组件的 ghost 翻转（同 key 复用保持 DOM 连续）。 */
export function registerClosingGhost(win: WindowInstance): void {
  // 同 id 重复登记（极快的双击关闭）只刷新兜底
  unregisterClosingGhost(win.id)
  const bailout = window.setTimeout(() => unregisterClosingGhost(win.id), 600)
  ghosts = [...ghosts, { win: { ...win, restoreBounds: null }, bailout }]
  emit()
}

/** 飞行终局（或卸载清理）时注销。 */
export function unregisterClosingGhost(id: string): void {
  const next = ghosts.filter((entry) => entry.win.id !== id)
  if (next.length === ghosts.length) return
  for (const entry of ghosts) {
    if (entry.win.id === id) window.clearTimeout(entry.bailout)
  }
  ghosts = next
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): GhostEntry[] {
  return ghosts
}

/** 测试隔离出口。 */
export function resetClosingGhosts(): void {
  for (const entry of ghosts) window.clearTimeout(entry.bailout)
  ghosts = []
  emit()
}

export { subscribe as subscribeClosingGhosts, getSnapshot as getClosingGhosts }
