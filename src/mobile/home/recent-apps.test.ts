import { describe, expect, it } from 'vitest'

import type { AppManifest } from '@/core/runtime'

import type { RecentEntry } from '@/store/usage-store'

import { RECENT_APPS_LIMIT, resolveRecentApps } from './recent-apps'

/**
 * M1-3 最近使用解析纯函数契约（RecentApps 的数据管线）：切片口径
 * 「取前 4 条 → 再解析」，解析不到的条目跳过且**不回填**第 5 条。
 */

const MANIFESTS: Record<string, AppManifest> = {
  'com.ageha.notes': {
    id: 'com.ageha.notes',
    name: 'Notes',
    version: '1.0.0',
    entry: '/apps/notes/index.html',
    permissions: [],
  },
  'com.ageha.files': {
    id: 'com.ageha.files',
    name: 'Files',
    version: '1.0.0',
    entry: '/apps/files/index.html',
    permissions: [],
  },
  'com.ageha.calculator': {
    id: 'com.ageha.calculator',
    name: 'Calculator',
    version: '1.0.0',
    entry: '/apps/calculator/index.html',
    permissions: [],
  },
  'com.ageha.terminal': {
    id: 'com.ageha.terminal',
    name: 'Terminal',
    version: '1.0.0',
    entry: '/apps/terminal/index.html',
    permissions: [],
  },
  'com.ageha.store': {
    id: 'com.ageha.store',
    name: 'App Store',
    version: '1.0.0',
    entry: '/apps/store/index.html',
    permissions: [],
  },
}

function entry(appId: string, at: number): RecentEntry {
  return { appId, at }
}

function resolve(appId: string): AppManifest | null {
  return MANIFESTS[appId] ?? null
}

describe('resolveRecentApps', () => {
  it('只取前 4 条（usage-store 时序，最新在前），第 5 条起不渲染', () => {
    const recent = [
      entry('com.ageha.notes', 1),
      entry('com.ageha.files', 2),
      entry('com.ageha.calculator', 3),
      entry('com.ageha.terminal', 4),
      entry('com.ageha.store', 5),
    ]

    const items = resolveRecentApps(recent, resolve)

    expect(RECENT_APPS_LIMIT).toBe(4)
    expect(items).toHaveLength(4)
    expect(items.map((item) => item.appId)).toEqual([
      'com.ageha.notes',
      'com.ageha.files',
      'com.ageha.calculator',
      'com.ageha.terminal',
    ])
  })

  it('坏条目跳过：解析不到的 appId 不出现在结果里', () => {
    const recent = [
      entry('com.ageha.notes', 1),
      entry('com.ageha.uninstalled', 2),
      entry('com.ageha.files', 3),
    ]

    const items = resolveRecentApps(recent, resolve)

    expect(items.map((item) => item.appId)).toEqual(['com.ageha.notes', 'com.ageha.files'])
    expect(items.map((item) => item.name)).toEqual(['Notes', 'Files'])
  })

  it('先截取后解析：前 4 中的坏条目跳过，不回填第 5 条（切片口径）', () => {
    const recent = [
      entry('com.ageha.notes', 1),
      entry('com.ageha.uninstalled', 2),
      entry('com.ageha.files', 3),
      entry('com.ageha.calculator', 4),
      entry('com.ageha.terminal', 5),
    ]

    const items = resolveRecentApps(recent, resolve)

    expect(items.map((item) => item.appId)).toEqual([
      'com.ageha.notes',
      'com.ageha.files',
      'com.ageha.calculator',
    ])
  })

  it('全部解析失败 → 空数组（组件据此整块缺席）', () => {
    const recent = [entry('com.ageha.gone-a', 1), entry('com.ageha.gone-b', 2)]

    expect(resolveRecentApps(recent, resolve)).toEqual([])
  })

  it('空 recent → 空数组', () => {
    expect(resolveRecentApps([], resolve)).toEqual([])
  })

  it('limit 可注入（默认 RECENT_APPS_LIMIT = 4）', () => {
    const recent = [entry('com.ageha.notes', 1), entry('com.ageha.files', 2)]

    expect(resolveRecentApps(recent, resolve, 1)).toEqual([
      { appId: 'com.ageha.notes', name: 'Notes' },
    ])
  })
})
