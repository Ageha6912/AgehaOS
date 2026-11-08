/**
 * 移动端同文档 history 分层栈（MobileAppHost 与四张覆盖层共用）。
 *
 * 浏览器返回键只有一条真栈，我们的「应用视图」「Bottom Sheet 覆盖层」都是
 * UI 层：进入应用视图压一条应用栈位；任一覆盖层（启动器 / 通知中心 / 控制
 * 中心 / 最近任务）打开再压一条自己的栈位。popstate 消费**栈顶**层——上层
 * 先关（覆盖层），应用视图只在覆盖层全部关掉后才退出，Home 上按返回键先关
 * 覆盖层而不是直接离开 AgehaOS（M3-2 覆盖层层级 + F1/F2 审查补全）。
 *
 * 记账口径（module-level 栈，popstate 消费者唯一 = MobileAppHost）：
 * - **应用视图至多一条应用栈位**：应用间切换只更新 appId，不再逐次叠栈
 *   （否则每次切换都留一条同文档残位，Home 上按返回键看似无响应）；
 * - 覆盖层打开按打开序叠在应用栈位之上；**从覆盖层直接进入应用视图**（启
 *   动器选中应用、通知跳转、最近任务切卡）时，若栈顶是覆盖层且应用栈位尚
 *   不存在，把覆盖层栈位**改写**成应用栈位（replaceState）——跳转不额外叠
 *   一条，也避开「back() 遍历是异步任务、同 tick 再 pushState 会把新栈位
 *   挤进前进分支」的竞态；
 * - **UI 主动关闭层**：仅当该层是栈顶时回退一条（back() 触发的 popstate 由
 *   consumeSuppressedPop 吞掉）；非栈顶不预消费别人的条目（防御位，正常交
 *   互不会出现）；
 * - popstate 消费栈顶（consumeMobileHistoryLayer），调用方按层类型关覆盖层
 *   或回 home；栈空（Home 无覆盖层）时 popstate 无副作用。
 */

/** 覆盖层种类（与四张 Bottom Sheet 一一对应）。 */
export type MobileOverlay = 'launcher' | 'notifications' | 'controlcenter' | 'recents'

type MobileHistoryLayer =
  | { kind: 'app'; appId: string }
  | { kind: 'overlay'; overlay: MobileOverlay }

let layers: MobileHistoryLayer[] = []
/** 未落地的自触发 back() 计数（back 遍历异步；多次关闭各吞一次 popstate）。 */
let suppressedPops = 0

/** 应用栈位的 state 标记（同文档，不带 URL；既有测试断言口不变）。 */
const APP_STATE_KEY = 'agehaMobileApp'

function topLayer(): MobileHistoryLayer | null {
  return layers[layers.length - 1] ?? null
}

function findAppLayerIndex(): number {
  return layers.findIndex((layer) => layer.kind === 'app')
}

function findOverlayLayerIndex(overlay: MobileOverlay): number {
  return layers.findIndex((layer) => layer.kind === 'overlay' && layer.overlay === overlay)
}

/**
 * 应用视图入栈：已存在应用栈位时只更新 appId（切换应用不叠栈）；正值覆盖
 * 层（从启动器/通知/最近任务进入应用）时把栈顶覆盖层栈位改写成应用栈位，
 * 不新增历史条目。返回 home 后应用栈位已被消费，再进应用才真正 push。
 */
export function pushAppHistoryEntry(appId: string): void {
  const appIndex = findAppLayerIndex()
  if (appIndex !== -1) {
    ;(layers[appIndex] as { kind: 'app'; appId: string }).appId = appId
    // 应用栈位就是当前条目时才同步 state 标记（覆盖层打开时当前条目是栈顶
    // 覆盖层，不能把应用标记写到它头上）；不新增条目。
    if (appIndex === layers.length - 1) {
      window.history.replaceState({ [APP_STATE_KEY]: appId }, '')
    }
    return
  }
  const top = topLayer()
  if (top !== null && top.kind === 'overlay') {
    layers[layers.length - 1] = { kind: 'app', appId }
    window.history.replaceState({ [APP_STATE_KEY]: appId }, '')
    return
  }
  layers.push({ kind: 'app', appId })
  window.history.pushState({ [APP_STATE_KEY]: appId }, '')
}

/** UI 返回：消费自己的应用栈位（仅当栈顶时回退，popstate 由抑制器吞掉）。 */
export function closeAppHistoryEntry(): void {
  const index = findAppLayerIndex()
  if (index === -1) return
  const isTop = index === layers.length - 1
  layers.splice(index, 1)
  if (!isTop) return
  suppressedPops += 1
  window.history.back()
}

/** 覆盖层打开：同一覆盖层只压一条（重开不重复叠）。 */
export function pushOverlayHistoryEntry(overlay: MobileOverlay): void {
  if (findOverlayLayerIndex(overlay) !== -1) return
  layers.push({ kind: 'overlay', overlay })
  // 覆盖层与最近任务同一 state 键位（既有测试断言口 agehaMobileRecents 的
  // 后继口径）：值 = 覆盖层种类，便于排查时区分。
  window.history.pushState({ agehaMobileOverlay: overlay }, '')
}

/** UI 关闭覆盖层：栈顶时消费自己压的栈位（非栈顶只摘记账，不预消费别人）。 */
export function closeOverlayHistoryEntry(overlay: MobileOverlay): void {
  const index = findOverlayLayerIndex(overlay)
  if (index === -1) return
  const isTop = index === layers.length - 1
  layers.splice(index, 1)
  if (!isTop) return
  suppressedPops += 1
  window.history.back()
}

/**
 * history 分层同步（MobileAppHost 的单一接线口）：先补应用栈位，再按「关
 * 闭优先、打开在后」同步覆盖层记账。应用入栈先于覆盖层关闭，是为了让「启
 * 动器选中应用」这类同批事件走 replaceState 改写而不是 back + push 竞态。
 */
export function syncOverlayHistory(open: readonly MobileOverlay[]): void {
  const wanted = new Set(open)
  const current = layers
    .filter((layer): layer is { kind: 'overlay'; overlay: MobileOverlay } => layer.kind === 'overlay')
    .map((layer) => layer.overlay)
  for (const overlay of current) {
    if (!wanted.has(overlay)) closeOverlayHistoryEntry(overlay)
  }
  for (const overlay of open) pushOverlayHistoryEntry(overlay)
}

/** popstate 首查：本次 pop 是否由 UI 关闭路径自己触发的 back()。 */
export function consumeSuppressedPop(): boolean {
  if (suppressedPops === 0) return false
  suppressedPops -= 1
  return true
}

/**
 * popstate 消费栈顶层（调用方按 kind 关覆盖层 / 回 home）。返回 null = 栈
 * 空（Home 无覆盖层或残留条目已被消化），调用方无副作用。
 */
export function consumeMobileHistoryLayer(): MobileHistoryLayer | null {
  return layers.pop() ?? null
}

/**
 * 回 home 后清空应用栈位记账（残留条目由 popstate 无害消化，M1-6 口径）：
 * 僵尸窗口/启动失败等不走 UI 返回的路径没有 back() 可消费，只摘记账；
 * 覆盖层栈位不动（其开合由 syncOverlayHistory 独立处理）。
 */
export function resetAppHistoryEntry(): void {
  layers = layers.filter((layer) => layer.kind !== 'app')
  // 记账清空 = 没有待消费的层：清掉可能永远不会落地的抑制计数（首条历史
  // 上 back() 无 popstate 的极端档）；仍有覆盖层时保留（其 pop 还在路上）。
  if (layers.length === 0) suppressedPops = 0
}

/** 测试隔离出口。 */
export function resetMobileHistoryForTests(): void {
  layers = []
  suppressedPops = 0
}
