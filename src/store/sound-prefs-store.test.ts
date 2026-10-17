import { beforeEach, describe, expect, it } from 'vitest'

import {
  reloadSoundPrefsStore,
  resetSoundPrefsStore,
  useSoundPrefsStore,
} from './sound-prefs-store'

beforeEach(() => {
  resetSoundPrefsStore()
})

describe('sound-prefs-store（音效偏好：设备本地，不进云同步）', () => {
  it('默认开', () => {
    expect(useSoundPrefsStore.getState().enabled).toBe(true)
  })

  it('setEnabled 持久化到 localStorage，重载后保留', () => {
    useSoundPrefsStore.getState().setEnabled(false)
    expect(useSoundPrefsStore.getState().enabled).toBe(false)
    expect(localStorage.getItem('agehaos.sound.prefs.v1')).toBe('{"enabled":false}')

    reloadSoundPrefsStore()
    expect(useSoundPrefsStore.getState().enabled).toBe(false)
  })

  it('坏数据兜底回默认（开）', () => {
    localStorage.setItem('agehaos.sound.prefs.v1', '{"enabled":"yes"}')
    reloadSoundPrefsStore()
    expect(useSoundPrefsStore.getState().enabled).toBe(true)

    localStorage.setItem('agehaos.sound.prefs.v1', 'not-json{')
    reloadSoundPrefsStore()
    expect(useSoundPrefsStore.getState().enabled).toBe(true)
  })

  it('reset 恢复默认并清持久化', () => {
    useSoundPrefsStore.getState().setEnabled(false)
    resetSoundPrefsStore()
    expect(useSoundPrefsStore.getState().enabled).toBe(true)
    expect(localStorage.getItem('agehaos.sound.prefs.v1')).toBeNull()
  })
})
