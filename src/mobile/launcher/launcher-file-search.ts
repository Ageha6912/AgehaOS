/**
 * 移动启动器全域搜索的分组/截断纯函数与阈值常量（M4-1，零 React 零 store
 * 依赖，launcher-filter.ts 同款拆法）：应用域沿用 launcher-filter 即时过滤
 * （manifest.name，空查询全量直通），文件域来自 systemVfs.search（异步，
 * 组件侧防抖后调用，use-debounced-value 承接）。两组各自截断到
 * LAUNCHER_GROUP_LIMIT 条 + truncated 标记——UI 渲染静态「已截断」提示文案
 * （带全量计数与上限），不做假按钮。空组返回 null，调用方整组缺席
 * （§35.7 空态铁律：缺席的是结果，抽屉本身在场）。
 */

/** 文件域输入防抖（切片指定约 200ms）：字符停顿后才发起 VFS 搜索。 */
export const LAUNCHER_FILE_SEARCH_DEBOUNCE_MS = 200

/** 每组结果截断上限（切片指定如 8 条）。 */
export const LAUNCHER_GROUP_LIMIT = 8

/** 文件域结果行（VfsSearchResult 的展示投影：名称 + 完整路径 + 类型）。 */
export interface LauncherFileMatch {
  name: string
  path: string
  type: 'directory' | 'file'
}

/** 单组结果：截断后的展示行 + 全量计数 + 是否截断（提示文案的参数）。 */
export interface LauncherResultGroup<T> {
  key: 'apps' | 'files'
  items: T[]
  total: number
  truncated: boolean
}

export interface LauncherResultGroups<TApp, TFile> {
  apps: LauncherResultGroup<TApp> | null
  files: LauncherResultGroup<TFile> | null
}

function toGroup<T>(key: 'apps' | 'files', items: readonly T[]): LauncherResultGroup<T> {
  const total = items.length
  return {
    key,
    // 截断只裁展示行；total 保留全量供「共 N 条」提示，slice 返回新数组、
    // 输入不被原地修改。
    items: items.slice(0, LAUNCHER_GROUP_LIMIT),
    total,
    truncated: total > LAUNCHER_GROUP_LIMIT,
  }
}

/**
 * 分组装配：应用组在前、文件组在后；空组 = null（整组缺席）。输入保序
 * （应用侧已由 mobile-app-order 排序、VFS 侧按搜索原序），本函数不做排序。
 */
export function groupLauncherResults<TApp, TFile>(
  apps: readonly TApp[],
  files: readonly TFile[],
): LauncherResultGroups<TApp, TFile> {
  return {
    apps: apps.length > 0 ? toGroup('apps', apps) : null,
    files: files.length > 0 ? toGroup('files', files) : null,
  }
}
