import { systemBus } from '@/core/events'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

/**
 * active window 按 Space 记忆（Window Management 2.0 W3，审计 .tmp/spaces-audit.md §6）。
 *
 * 职责：只消费 systemBus 事件、不 hook 组件——
 * - `window.focused`：窗口属**当前** Space 才 `setActiveWindow` 记忆
 *   （minimize/close 的 focusTopmost 补焦点可能落到其他 Space，不记）；
 * - `space.switched`：恢复目标 Space 焦点——记住的 activeWindowId 存活（且仍
 *   属该 Space，moveWindowToSpace 改派后不跨 Space 拉焦点）则按 taskbar 同款
 *   组合语义恢复（仅 minimized 才 restore，最大化记忆窗不被拍平）+ focus；
 *   否则聚焦该 Space zIndex 最大的可见窗（首次进入建栈）；空 Space 不聚焦。
 *
 * 挂载：Desktop.tsx 挂载 effect 显式 `startSpaceFocusTracking()`（幂等；
 * `stopSpaceFocusTracking()` 供测试隔离）。注意 `space.switched` 在
 * SpaceManager.switchSpace 内同步发出、早于 space-store 的 commit()——恢复
 * 逻辑必须用事件载荷的 spaceId，不得读 getState().activeSpaceId（stale）；
 * spaces 列表成员与各 Space 的 activeWindowId 字段不受切换影响，照常可读。
 * window.focused 侧的同类时序（create 先发事件后 commit）由微任务延后写
 * 统一消化（见 handler 内注释）。
 */
let trackingOffs: Array<() => void> = []

export function startSpaceFocusTracking(): void {
  if (trackingOffs.length > 0) return
  trackingOffs = [
    systemBus.on('window.focused', ({ windowId }) => {
      // create() 的 window.focused 在 window-store commit() **之前**同步发出
      // （WindowManager.create → emit → store 才 setState）——此刻 zustand 里
      // 还查不到新窗。记忆写入延后一个微任务：state 落定后按新鲜快照判守卫
      // （窗口存在 + 属当前 Space）。同一任务内多次聚焦按微任务 FIFO 排队，
      // 最后聚焦者覆盖写入；用户手势是独立任务，微任务必然在手势间清空。
      queueMicrotask(() => {
        if (trackingOffs.length === 0) return // 已 stop（测试隔离）
        const { activeSpaceId, setActiveWindow } = useSpaceStore.getState()
        const win = useWindowStore
          .getState()
          .windows.find((candidate) => candidate.id === windowId)
        if (!win || win.spaceId !== activeSpaceId) return
        setActiveWindow(activeSpaceId, windowId)
      })
    }),
    systemBus.on('space.switched', ({ spaceId }) => {
      restoreSpaceFocus(spaceId)
    }),
  ]
}

/** 测试隔离出口（幂等可重复调用）。 */
export function stopSpaceFocusTracking(): void {
  for (const off of trackingOffs) off()
  trackingOffs = []
}

function restoreSpaceFocus(spaceId: string): void {
  const remembered =
    useSpaceStore.getState().spaces.find((space) => space.id === spaceId)?.activeWindowId ?? null
  const windows = useWindowStore.getState().windows
  const { restore, focus } = useWindowStore.getState()
  const target = remembered
    ? windows.find((win) => win.id === remembered && win.spaceId === spaceId)
    : undefined
  if (target) {
    // taskbar 同款组合语义（Taskbar.tsx toggleWindow）：仅最小化才 restore
    // （最大化记忆窗不被拍平）；restore 本身会聚焦，focus 兜底补齐组合。
    if (target.state === 'minimized') restore(target.id)
    focus(target.id)
    return
  }
  // 回落：目标 Space zIndex 最大的可见窗；空 Space（或全部最小化）不聚焦。
  const visible = windows
    .filter((win) => win.spaceId === spaceId && win.state !== 'minimized')
    .sort((a, b) => a.zIndex - b.zIndex)
  const top = visible[visible.length - 1]
  if (top) focus(top.id)
}
