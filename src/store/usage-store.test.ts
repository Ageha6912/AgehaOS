import { beforeEach, describe, expect, it } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetWindowStore } from '@/store/window-store'

import { launchApp } from '@/apps/launch'

import { RECENT_LIMIT, resetUsageStore, useUsageStore } from './usage-store'

beforeEach(() => {
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetUsageStore()
})

describe('usage-store recent', () => {
  it('records user launches with the newest first', () => {
    launchApp('com.ageha.notes')
    launchApp('com.ageha.files')

    const ids = useUsageStore.getState().recent.map((entry) => entry.appId)
    expect(ids).toEqual(['com.ageha.files', 'com.ageha.notes'])
  })

  it('does not record system launches', () => {
    launchApp('com.ageha.notes', undefined, 'system')

    expect(useUsageStore.getState().recent).toHaveLength(0)
  })

  it('dedupes by appId and caps at the limit', () => {
    const record = useUsageStore.getState().recordRecentApp
    record('a')
    record('b')
    record('a') // 去重并置顶
    for (let index = 0; index < RECENT_LIMIT + 2; index += 1) {
      record(`app-${index}`)
    }

    const ids = useUsageStore.getState().recent.map((entry) => entry.appId)
    expect(ids).toHaveLength(RECENT_LIMIT)
    expect(ids[0]).toBe(`app-${RECENT_LIMIT + 1}`)
    expect(ids.filter((id) => id === 'a')).toHaveLength(0)
  })

  it('persists to localStorage and clears', () => {
    useUsageStore.getState().recordRecentApp('com.ageha.notes')

    const raw = JSON.parse(localStorage.getItem('agehaos.usage.recent.v1')!)
    expect(raw).toHaveLength(1)
    expect(raw[0].appId).toBe('com.ageha.notes')

  })
})
