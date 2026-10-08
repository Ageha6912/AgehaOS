/**
 * 移动 Home 应用网格的排序纯函数（M1-4，零 React 零 store 依赖）：
 *
 * 1. 常量优先序（切片口径）：`MOBILE_APP_ORDER` 列出的注册表全量 id 按表序
 *    在前——动态面板（今日世界卡的落点）最前，其余系统应用随后；
 * 2. 未列入的（羽化 L1 三件套、App Store 安装、运行时注册）按名称排后——
 *    名称由解析器注入（生产 = `appDisplayName`，与桌面启动器同一本地化
 *    展示名来源），小写后按码元序比较（不用 localeCompare，跨环境恒定）；
 * 3. 排序稳定（ES2019+ Array.prototype.sort）：同名保持注册表原序。
 *
 * 输入数组不被原地修改（返回新数组）。边界与序由 mobile-app-order.test.ts
 * 钉住。
 */

/** 网格优先序：列出的注册表全量 id 按此表序排前（切片 M1-4 指定）。 */
export const MOBILE_APP_ORDER: readonly string[] = [
  'com.ageha.dynamic.panel',
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.settings',
  'com.ageha.calculator',
  'com.ageha.store',
  'com.ageha.terminal',
]

/** 优先序名次：未列入的 id 一律返回 `Number.MAX_SAFE_INTEGER`（排后）。 */
export function mobileAppOrderRank(appId: string): number {
  const index = MOBILE_APP_ORDER.indexOf(appId)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * 已安装应用 → 网格渲染序（纯函数）：优先序成员按 `MOBILE_APP_ORDER` 表序
 * 在前，未列入的按注入解析器给出的展示名排后（小写码元序，大小写不敏感）。
 */
export function orderAppsForMobileGrid<T extends { id: string }>(
  apps: readonly T[],
  resolveName: (appId: string) => string,
): T[] {
  return [...apps].sort((a, b) => {
    const rankDelta = mobileAppOrderRank(a.id) - mobileAppOrderRank(b.id)
    if (rankDelta !== 0) return rankDelta
    const nameA = resolveName(a.id).toLowerCase()
    const nameB = resolveName(b.id).toLowerCase()
    if (nameA < nameB) return -1
    if (nameA > nameB) return 1
    return 0
  })
}
