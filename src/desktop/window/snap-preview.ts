/**
 * W5 Snap Preview 模块态（审计 .tmp/spaces-audit.md §8）。
 *
 * 拖拽中的吸附预览是纯表现层瞬态（不进引擎、不进 store 全局真相），照
 * closing-ghosts.ts 范式：模块级外部 store（listeners Set + 不可变替换），
 * SnapPreviewOverlay 经 useSyncExternalStore 消费。`rect` 直接用
 * calculateSnapGeometry 产物（与 W4 单一来源，预览=终态几何零换算）——
 * E2E 探针据此断言「预览矩形与松手后窗口几何像素级一致」。
 */
import type { WindowBounds } from '@/core/window'

interface SnapPreviewState {
  rect: WindowBounds | null
}

let state: SnapPreviewState = { rect: null }
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function sameRect(a: WindowBounds, b: WindowBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * 拖拽中命中左右缘：记预览矩形。重复 set 相同几何幂等（不替换快照、不通知
 * ——每帧 pointermove 反复命中同缘时零重渲染）；不同几何则不可变替换。
 */
export function setSnapPreview(rect: WindowBounds): void {
  if (state.rect && sameRect(state.rect, rect)) return
  state = { rect: { ...rect } }
  emit()
}

/** 离开判定带 / 指针收尾（pointerup/cancel/blur 全路径）：清预览；已空幂等。 */
export function clearSnapPreview(): void {
  if (!state.rect) return
  state = { rect: null }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): SnapPreviewState {
  return state
}

/** 测试隔离出口。 */
export function resetSnapPreview(): void {
  state = { rect: null }
  emit()
}

export { subscribe as subscribeSnapPreview, getSnapshot as getSnapPreview }
