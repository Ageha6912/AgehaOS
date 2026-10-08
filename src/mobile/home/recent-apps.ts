import type { AppManifest } from '@/core/runtime'

import type { RecentEntry } from '@/store/usage-store'

/**
 * Home 最近使用区的可见上限（M1-3）：usage-store 是最近启动的单一来源
 * （上限 8 条），移动 Home 只露出最新 4 条。
 */
export const RECENT_APPS_LIMIT = 4

/** 最近使用区的一个可渲染条目：解析成功的 manifest 摘要。 */
export interface RecentAppItem {
  appId: string
  name: string
}

/**
 * 最近条目 → 可渲染应用（纯函数，M1-3）：
 *
 * 1. 先按 usage-store 时序（最新在前）截取前 `limit` 条——切片口径
 *    「取前 4 条 → 再解析」；
 * 2. 再逐条经解析器（生产 = `getAppManifest`）解析 manifest，解析不到
 *    （已卸载 / 运行时应用已注销 / 脏数据）的条目跳过；
 * 3. 跳过**不回填**：第 5 条及以后不因前 4 中的坏条目而上浮。
 *
 * 零 React 零 store 依赖（解析器注入），边界与坏条目语义由
 * recent-apps.test.ts 钉住。
 */
export function resolveRecentApps(
  recent: readonly RecentEntry[],
  resolve: (appId: string) => AppManifest | null,
  limit: number = RECENT_APPS_LIMIT,
): RecentAppItem[] {
  const items: RecentAppItem[] = []
  for (const entry of recent.slice(0, limit)) {
    const manifest = resolve(entry.appId)
    if (manifest === null) continue
    items.push({ appId: entry.appId, name: manifest.name })
  }
  return items
}
