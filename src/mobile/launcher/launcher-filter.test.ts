import { describe, expect, it } from 'vitest'

import { filterAppsForLauncher } from './launcher-filter'

/**
 * M2-1 启动器搜索过滤纯函数契约：manifest.name 大小写不敏感子串匹配；
 * 空白查询全量直通（保序浅拷贝）；输入不被原地修改。过滤保序——排序职责
 * 单点在 mobile-app-order（组件侧先排后滤），本文件只钉过滤边界。
 */

const APPS = [
  { id: 'a', name: 'Files' },
  { id: 'b', name: 'notes' },
  { id: 'c', name: 'Dynamic Panel' },
]

describe('filterAppsForLauncher', () => {
  it('空查询 / 纯空白查询 = 全量直通（浅拷贝保序，输入不改）', () => {
    expect(filterAppsForLauncher(APPS, '')).toEqual(APPS)
    expect(filterAppsForLauncher(APPS, '   ')).toEqual(APPS)
    // 浅拷贝而非原数组：调用方放心的不可变语义。
    const result = filterAppsForLauncher(APPS, '')
    expect(result).not.toBe(APPS)
    expect(APPS).toHaveLength(3)
  })

  it('大小写不敏感子串匹配：FI / fi / file 都命中 Files', () => {
    const hit = (query: string): string[] =>
      filterAppsForLauncher(APPS, query).map((app) => app.id)
    expect(hit('FI')).toEqual(['a'])
    expect(hit('fi')).toEqual(['a'])
    expect(hit('file')).toEqual(['a'])
    expect(hit('panel')).toEqual(['c'])
  })

  it('查询串 trim 后再匹配：两侧空白不破坏命中', () => {
    expect(filterAppsForLauncher(APPS, '  notes  ').map((app) => app.id)).toEqual(['b'])
  })

  it('无命中 = 空数组（组件侧据此渲染空态文案）', () => {
    expect(filterAppsForLauncher(APPS, 'zzz')).toEqual([])
  })

  it('保序：命中多条时保持输入序（排序不归本函数）', () => {
    // 'n' 命中 notes 与 Dynamic Panel（Dynamic 含 n），不命中 Files。
    expect(filterAppsForLauncher(APPS, 'n').map((app) => app.id)).toEqual(['b', 'c'])
  })
})
