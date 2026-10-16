import type { WindowState } from '@/core/window'

/**
 * Dock Space 感知纯判定（Window Management 2.0 W9，审计 .tmp/spaces-audit.md
 * §12 决定 1/2/4）：渲染期派生、零 DOM 零订阅——输入窗口快照 + activeSpaceId，
 * 输出瓷贴两档指示与点击计划。调用方（Taskbar）消费 windows/activeSpaceId
 * 既有订阅即可，本模块不新增订阅源。
 */

/** 瓷贴代表窗的结构子集（WindowInstance 天然满足；测试可造最小快照）。 */
export interface DockWindowRef {
  id: string
  appId: string
  spaceId: string
  focused: boolean
  state: WindowState
}

/**
 * 瓷贴指示两档（§12 决定 1）：'active'=代表窗在当前 Space 且聚焦可见——
 * 既有 primary 条语义零变化；'elsewhere'=代表窗在其他 Space——subtle 圆点
 * （降不透明度档，无新 token 无新动效）+ tooltip「在其他空间」；null=无指示
 * （无窗口，或当前 Space 窗未聚焦/已最小化——与既有「不亮」口径一致）。
 */
export type DockTileTier = 'active' | 'elsewhere' | null

export interface DockTileState<T extends DockWindowRef> {
  /** 瓷贴代表窗（悬停/点击目标）：当前 Space 最新窗优先，无则跨 Space 最新窗；无窗 null。 */
  latest: T | null
  tier: DockTileTier
}

/**
 * 「最新窗口」跨 Space 选取（§12 决定 1 钉扎）：一个 app 多窗分居多 Space
 * 时，**当前 Space 的最新窗优先**——active 判定不被其他 Space 的更新窗顶掉；
 * 无当前 Space 窗才回落其他 Space 最新窗。windows 数组序=创建序，末位最新。
 */
export function resolveTileState<T extends DockWindowRef>(
  windows: readonly T[],
  appId: string,
  activeSpaceId: string,
): DockTileState<T> {
  let inSpace: T | null = null
  let elsewhere: T | null = null
  for (const win of windows) {
    if (win.appId !== appId) continue
    if (win.spaceId === activeSpaceId) inSpace = win
    else elsewhere = win
  }
  const latest = inSpace ?? elsewhere
  if (!latest) return { latest: null, tier: null }
  if (latest.spaceId !== activeSpaceId) return { latest, tier: 'elsewhere' }
  // 当前 Space：active 条语义零变化（focused && state!=='minimized'）。
  const tier: DockTileTier = latest.focused && latest.state !== 'minimized' ? 'active' : null
  return { latest, tier }
}

/** 瓷贴/运行行点击计划（§12 决定 2，macOS Dock 惯例）。 */
export type DockActivation =
  | { kind: 'launch' }
  | { kind: 'toggle'; windowId: string; focused: boolean; minimized: boolean }
  | { kind: 'cross-space'; spaceId: string; windowId: string }

/**
 * 瓷贴点击语义（§12 决定 2）：无窗=启动；代表窗在其他 Space=**switchSpace +
 * restore/focus**（macOS 惯例，不把窗拉过来自建第三种归属语义——组合语义
 * 复用 mission-control-store 的 activateCardWindow）；当前 Space 窗=既有
 * toggle 语义零变化。
 */
export function resolveActivation(state: DockTileState<DockWindowRef>): DockActivation {
  const latest = state.latest
  if (!latest) return { kind: 'launch' }
  if (state.tier === 'elsewhere') {
    return { kind: 'cross-space', spaceId: latest.spaceId, windowId: latest.id }
  }
  return {
    kind: 'toggle',
    windowId: latest.id,
    focused: latest.focused,
    minimized: latest.state === 'minimized',
  }
}
