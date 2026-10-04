/**
 * 启动器「打开即定位」意图（Desktop Shell 3.0 STEP 3 今日世界入口）：外部
 * 入口（Workspace Panel 的「查看世界」）需要打开启动器并直接落在指定分类，
 * 而 launcher-store 按裁决只放开合（搜索词/分类是 AppLauncher 的本地 UI 态，
 * 见该文件头注）——沿用 src/apps/app-deep-link.ts 的模块级一次性意图范式：
 * launch/open 前写入、AppLauncher 打开时取走即清，不改 store 数据结构。
 */

/** 可被外部入口深链的启动器分类（今日世界 = 「今日」分类）。 */
export type LauncherCategoryIntent = 'today'

let requestedCategory: LauncherCategoryIntent | null = null

/** 请求下一次启动器打开直接落在指定分类（幂等：覆盖未消费的旧请求）。 */
export function requestLauncherCategory(category: LauncherCategoryIntent): void {
  requestedCategory = category
}

/** AppLauncher 打开时消费（取走即清；null = 无请求，维持上次的分类）。 */
export function consumeLauncherCategory(): LauncherCategoryIntent | null {
  const value = requestedCategory
  requestedCategory = null
  return value
}

/** 测试隔离：清空未消费意图。 */
export function resetLauncherIntent(): void {
  requestedCategory = null
}
