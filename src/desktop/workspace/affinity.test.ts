import { describe, expect, it } from 'vitest'

import {
  LAUNCHER_CATEGORY_MEMBERS,
  launcherCategoriesFor,
  launcherWorkspaceScore,
  rankByScore,
  worldWorkspaceScore,
} from './affinity'

describe('workspace affinity（工作空间亲和排序，纯函数）', () => {
  it('launcherCategoriesFor reports every category an app belongs to', () => {
    expect(launcherCategoriesFor('com.ageha.files')).toEqual(['system', 'office'])
    expect(launcherCategoriesFor('com.ageha.terminal')).toEqual(['dev', 'tools'])
    expect(launcherCategoriesFor('com.ageha.does.not.exist')).toEqual([])
  })

  it('dev workspace boosts terminal above notes; personal boosts files above terminal', () => {
    expect(launcherWorkspaceScore('com.ageha.terminal', 'dev')).toBeGreaterThan(
      launcherWorkspaceScore('com.ageha.notes', 'dev'),
    )
    expect(launcherWorkspaceScore('com.ageha.files', 'personal')).toBeGreaterThan(
      launcherWorkspaceScore('com.ageha.terminal', 'personal'),
    )
    // 学习空间：计算器（tools）有亲和；创作空间：画板（fun）有亲和。
    expect(launcherWorkspaceScore('com.ageha.calculator', 'study')).toBeGreaterThan(0)
    expect(launcherWorkspaceScore('com.ageha.samples.sketch', 'creative')).toBeGreaterThan(0)
  })

  it('worldWorkspaceScore maps the six world categories per workspace', () => {
    expect(worldWorkspaceScore('creative', 'creative')).toBeGreaterThan(
      worldWorkspaceScore('news', 'creative'),
    )
    expect(worldWorkspaceScore('news', 'study')).toBeGreaterThan(0)
    expect(worldWorkspaceScore('tools', 'dev')).toBeGreaterThan(0)
    expect(worldWorkspaceScore('life', 'personal')).toBeGreaterThan(0)
    // 无亲和 = 0，不参与前插。
    expect(worldWorkspaceScore('games', 'dev')).toBe(0)
  })

  it('rankByScore sorts descending and keeps input order among equal scores (时序不乱)', () => {
    const recent = ['a', 'b', 'c', 'd']
    const ranked = rankByScore(recent, (id) => (id === 'c' ? 2 : id === 'a' ? 1 : 0))

    expect(ranked).toEqual(['c', 'a', 'b', 'd'])
    // 输入数组不被修改。
    expect(recent).toEqual(['a', 'b', 'c', 'd'])
  })

  it('LAUNCHER_CATEGORY_MEMBERS keeps the launcher taxonomy intact（上收不改内容）', () => {
    expect(LAUNCHER_CATEGORY_MEMBERS.dev).toEqual(['com.ageha.terminal'])
    expect(LAUNCHER_CATEGORY_MEMBERS.system).toContain('com.ageha.settings')
    expect(LAUNCHER_CATEGORY_MEMBERS.tools).toContain('com.ageha.eclosion.notes')
  })
})
