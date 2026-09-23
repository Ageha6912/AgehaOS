/**
 * 全局搜索的纯匹配逻辑（PRD §15：App + 文件两域，本地即时匹配）。
 * 设置/命令/AI Search 属后续阶段（PRD §15「后续」清单）。
 */

export interface SearchableApp {
  id: string
  name: string
  /** 当前语言的展示名（调用方经词典解析后传入）。 */
  title: string
}

export interface SearchHit {
  kind: 'app' | 'file'
  id: string
  title: string
  /** 文件结果为完整路径；应用为空。 */
  path?: string
}

function scoreOf(text: string, query: string): number {
  const lower = text.toLowerCase()
  if (lower.startsWith(query)) return 2
  if (lower.includes(query)) return 1
  return 0
}

/** 应用匹配：展示名 / manifest 名 / appId 三路 includes，前缀命中靠前。 */
export function rankApps(query: string, apps: readonly SearchableApp[]): SearchableApp[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []
  return apps
    .map((app) => ({
      app,
      score: Math.max(
        scoreOf(app.title, q),
        scoreOf(app.name, q),
        scoreOf(app.id, q),
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.app.id.localeCompare(b.app.id))
    .slice(0, 5)
    .map((entry) => entry.app)
}

/** 文件结果裁剪：Vfs.search 已按名称匹配，这里只做数量上限。 */
export function limitFiles<T>(files: readonly T[]): T[] {
  return files.slice(0, 5)
}
