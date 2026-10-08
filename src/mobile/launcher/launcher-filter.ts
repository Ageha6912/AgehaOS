/**
 * 移动启动器搜索过滤纯函数（M2-1，零 React 零 store 依赖，greeting.ts /
 * recent-apps.ts 同款拆法）：过滤口径 = 切片指定的 **manifest.name 大小写
 * 不敏感子串匹配**——`name` 是注册表数据（AppManifest.name，locale 无关），
 * 与展示名解析（appDisplayName / titleKey）解耦，桌面启动器的展示名语义
 * 不在此复刻。查询串先 trim 再小写；空查询 = 全量直通（浅拷贝保序，不
 * 复制排序职责——排序归 mobile-app-order，组件侧先排后滤）。
 *
 * 输入数组不被原地修改（返回新数组）。边界由 launcher-filter.test.ts 钉住。
 */

/** manifest.name 大小写不敏感子串过滤；空白查询返回全量浅拷贝（保序）。 */
export function filterAppsForLauncher<T extends { name: string }>(
  apps: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...apps]
  return apps.filter((app) => app.name.toLowerCase().includes(needle))
}
