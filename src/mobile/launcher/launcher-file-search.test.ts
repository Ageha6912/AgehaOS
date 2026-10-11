import { describe, expect, it } from 'vitest'

import {
  groupLauncherResults,
  LAUNCHER_FILE_SEARCH_DEBOUNCE_MS,
  LAUNCHER_GROUP_LIMIT,
} from './launcher-file-search'

/**
 * 分组/截断纯函数契约（M4-1）：应用组在前、文件组在后，空组 = null；每组
 * 截到 LAUNCHER_GROUP_LIMIT 条、超出置 truncated（total 保留全量）；输入
 * 保序且不被原地修改。防抖阈值一并钉扎（切片指定约 200ms）。
 */

interface Probe {
  id: string
}

function probe(id: string): Probe {
  return { id }
}

function probes(...ids: string[]): Probe[] {
  return ids.map(probe)
}

describe('launcher-file-search', () => {
  it('常量钉扎：防抖 200ms / 每组上限 8 条（切片契约字面量）', () => {
    expect(LAUNCHER_FILE_SEARCH_DEBOUNCE_MS).toBe(200)
    expect(LAUNCHER_GROUP_LIMIT).toBe(8)
  })

  it('双组在场：应用组在前、文件组在后，key 各归各位', () => {
    const groups = groupLauncherResults(probes('a', 'b'), probes('f'))

    expect(groups.apps).not.toBeNull()
    expect(groups.apps!.key).toBe('apps')
    expect(groups.apps!.items).toEqual(probes('a', 'b'))
    expect(groups.files).not.toBeNull()
    expect(groups.files!.key).toBe('files')
    expect(groups.files!.items).toEqual(probes('f'))
  })

  it('空组 = null：只命中应用时文件组整组缺席（反之亦然）', () => {
    const appsOnly = groupLauncherResults(probes('a'), [])
    expect(appsOnly.apps).not.toBeNull()
    expect(appsOnly.files).toBeNull()

    const filesOnly = groupLauncherResults([], probes('f'))
    expect(filesOnly.apps).toBeNull()
    expect(filesOnly.files).not.toBeNull()

    const neither = groupLauncherResults([], [])
    expect(neither.apps).toBeNull()
    expect(neither.files).toBeNull()
  })

  it('恰在上限内（8 条）不截断；超过（9 条）只保留 8 行且 total 保留全量', () => {
    // 8 条应用：恰在上限，不截断。
    const eight = probes('1', '2', '3', '4', '5', '6', '7', '8')
    const atLimitGroup = groupLauncherResults(eight, []).apps!
    expect(atLimitGroup.items).toHaveLength(8)
    expect(atLimitGroup.total).toBe(8)
    expect(atLimitGroup.truncated).toBe(false)

    const nine = probes('1', '2', '3', '4', '5', '6', '7', '8', '9')
    const overGroup = groupLauncherResults(nine, []).apps!
    expect(overGroup.items).toHaveLength(LAUNCHER_GROUP_LIMIT)
    expect(overGroup.items).toEqual(nine.slice(0, LAUNCHER_GROUP_LIMIT))
    expect(overGroup.total).toBe(9)
    expect(overGroup.truncated).toBe(true)
  })

  it('文件组独立截断：应用不超限而文件超限时只有文件组置 truncated', () => {
    const files = probes('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11')
    const groups = groupLauncherResults(probes('a', 'b'), files)

    expect(groups.apps!.truncated).toBe(false)
    expect(groups.files!.truncated).toBe(true)
    expect(groups.files!.total).toBe(11)
    expect(groups.files!.items).toHaveLength(8)
  })

  it('输入保序且不被原地修改（截断经 slice 返回新数组）', () => {
    const apps = probes('a1', 'a2', 'a3')
    const files = probes('f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9')
    const appsSnapshot = [...apps]
    const filesSnapshot = [...files]

    const groups = groupLauncherResults(apps, files)

    expect(apps).toEqual(appsSnapshot)
    expect(files).toEqual(filesSnapshot)
    expect(groups.apps!.items).not.toBe(apps)
    expect(groups.files!.items).not.toBe(files)
    expect(groups.files!.items.map((item) => item.id)).toEqual([
      'f1',
      'f2',
      'f3',
      'f4',
      'f5',
      'f6',
      'f7',
      'f8',
    ])
  })
})
