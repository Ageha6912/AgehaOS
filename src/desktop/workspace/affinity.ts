import type { WorkspaceId } from '@/store/workspace-store'

/**
 * 工作空间亲和排序（Desktop Shell 3.0 STEP 2）：纯函数层——把当前工作空间
 * 偏好翻译成启动器分类/今日世界分类的稳定排序。只影响「排序」不影响「存
 * 在」：工作空间不增删任何应用（无硬编码白名单之外的假数据），同分保持
 * 原序（最近使用保持时间序、世界清单保持生成序）。
 *
 * 映射口径（与启动器分类轨 CATEGORY_MEMBERS / 世界行 category
 * games·tools·social·creative·news·life 对齐）：
 * - 个人 → 系统日常（system/office；世界行 life/social/news）
 * - 学习 → 记事/文件/计算器（office/tools；世界行 news/tools）
 * - 开发 → 终端/工具（dev/tools；世界行 tools）
 * - 创作 → 游戏与画板（fun；世界行 creative/games）
 */

/** 启动器静态分类成员（自 AppLauncher 上收共享：Workspace Panel 的最近
 * 使用排序与启动器消费同一份映射，禁止第二套）。 */
export const LAUNCHER_CATEGORY_MEMBERS: Record<
  'system' | 'dev' | 'office' | 'fun' | 'tools' | 'settings',
  readonly string[]
> = {
  system: ['com.ageha.files', 'com.ageha.store', 'com.ageha.settings', 'com.ageha.dynamic.panel'],
  dev: ['com.ageha.terminal'],
  office: ['com.ageha.notes', 'com.ageha.files'],
  fun: [
    'com.ageha.games.snake',
    'com.ageha.games.2048',
    'com.ageha.games.memory',
    'com.ageha.games.mines',
    'com.ageha.samples.sketch',
    'com.ageha.samples.clock',
  ],
  tools: [
    'com.ageha.calculator',
    'com.ageha.terminal',
    'com.ageha.samples.sticky',
    'com.ageha.samples.clock',
    // 羽化三件套（开关开且该应用为羽化版时才可见）。
    'com.ageha.eclosion.calculator',
    'com.ageha.eclosion.notes',
    'com.ageha.eclosion.clock',
  ],
  settings: ['com.ageha.settings'],
}

/** 工作空间 → 亲和的启动器分类（靠前 = 亲和更强）。 */
const WORKSPACE_LAUNCHER_CATEGORIES: Record<WorkspaceId, readonly string[]> = {
  personal: ['system', 'office'],
  study: ['office', 'tools'],
  dev: ['dev', 'tools'],
  creative: ['fun'],
}

/** 工作空间 → 亲和的今日世界分类（世界行 category ∈ 六类，prompts.ts 契约）。 */
const WORKSPACE_WORLD_CATEGORIES: Record<WorkspaceId, readonly string[]> = {
  personal: ['life', 'social', 'news'],
  study: ['news', 'tools'],
  dev: ['tools'],
  creative: ['creative', 'games'],
}

/** appId 在启动器分类映射中的全部归属（分类名列表）。 */
export function launcherCategoriesFor(appId: string): readonly string[] {
  return Object.entries(LAUNCHER_CATEGORY_MEMBERS)
    .filter(([, members]) => members.includes(appId))
    .map(([category]) => category)
}

/**
 * 亲和分：命中第 i 个亲和分类 = 类别总数 − i（越靠前分越高），未命中 = 0。
 * 返回值只用于相互比较，不跨表稳定。
 */
export function workspaceCategoryScore(
  categories: readonly string[],
  affinity: readonly string[],
): number {
  let best = 0
  for (const category of categories) {
    const index = affinity.indexOf(category)
    if (index >= 0) best = Math.max(best, affinity.length - index)
  }
  return best
}

/** 启动器应用对当前工作空间的亲和分（0 = 无特别亲和）。 */
export function launcherWorkspaceScore(appId: string, workspace: WorkspaceId): number {
  return workspaceCategoryScore(
    launcherCategoriesFor(appId),
    WORKSPACE_LAUNCHER_CATEGORIES[workspace],
  )
}

/** 今日世界应用行（category 字段）对当前工作空间的亲和分。 */
export function worldWorkspaceScore(category: string, workspace: WorkspaceId): number {
  return workspaceCategoryScore([category], WORKSPACE_WORLD_CATEGORIES[workspace])
}

/**
 * 稳定降序排序：分数高者靠前，同分保持输入原序（最近使用的时序/世界清单
 * 的生成序不因排序被打乱）。不修改输入数组。
 */
export function rankByScore<T>(items: readonly T[], scoreOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreOf(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item)
}
