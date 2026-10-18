/**
 * 站点数据（服务端 Cookie 罐）的客户端面：起始页只消费**元信息**
 * （源列表 + 条目数）——cookie 值永远不离开服务端。
 * 失败静默（本地预览/后端不可用/未登录时返回 null，UI 隐藏区块）。
 */

export interface SiteDataSummary {
  count: number
  origins: string[]
}

const SUMMARY_URL = '/api/browse/cookies'
const CLEAR_URL = '/api/browse/cookies/clear'

export async function fetchSiteDataSummary(): Promise<SiteDataSummary | null> {
  try {
    const response = await fetch(SUMMARY_URL, { credentials: 'same-origin' })
    if (!response.ok) return null
    const payload = (await response.json()) as Partial<SiteDataSummary>
    if (typeof payload.count !== 'number' || !Array.isArray(payload.origins)) return null
    return { count: payload.count, origins: payload.origins.filter((o) => typeof o === 'string') }
  } catch {
    return null
  }
}

export async function clearSiteData(): Promise<boolean> {
  try {
    const response = await fetch(CLEAR_URL, { method: 'POST', credentials: 'same-origin' })
    return response.ok
  } catch {
    return false
  }
}
