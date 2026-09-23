import { describe, expect, it } from 'vitest'

import { limitFiles, rankApps } from './search'

const APPS = [
  { id: 'com.ageha.notes', name: 'Notes', title: '记事' },
  { id: 'com.ageha.settings', name: 'Settings', title: '设置' },
  { id: 'com.ageha.samples.sticky', name: 'Sticky Notes', title: '便签' },
]

describe('rankApps (PRD §15)', () => {
  it('matches title, manifest name and appId, case-insensitively', () => {
    expect(rankApps('记', APPS).map((app) => app.id)).toEqual(['com.ageha.notes'])
    expect(rankApps('settings', APPS).map((app) => app.id)).toEqual(['com.ageha.settings'])
    expect(rankApps('STICKY', APPS).map((app) => app.id)).toEqual(['com.ageha.samples.sticky'])
  })

  it('ranks prefix hits before substring hits', () => {
    const apps = [...APPS, { id: 'com.ageha.samples.clock', name: 'World Clock', title: '世界时钟' }]
    expect(rankApps('世', apps).map((app) => app.id)).toEqual(['com.ageha.samples.clock'])
  })

  it('is empty for blank queries and non-matches', () => {
    expect(rankApps('   ', APPS)).toEqual([])
    expect(rankApps('zzz', APPS)).toEqual([])
  })

  it('caps results at five', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `com.example.app${index}`,
      name: `App${index}`,
      title: `应用${index}`,
    }))
    expect(rankApps('app', many)).toHaveLength(5)
  })
})

describe('limitFiles', () => {
  it('caps file results at five', () => {
    expect(limitFiles([1, 2, 3, 4, 5, 6, 7] as unknown[])).toHaveLength(5)
    expect(limitFiles([])).toEqual([])
  })
})
