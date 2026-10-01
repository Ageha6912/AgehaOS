import { beforeEach, describe, expect, it } from 'vitest'

import { reloadMotionPrefsStore, resetMotionPrefsStore, useMotionPrefsStore } from './motion-prefs-store'

beforeEach(() => {
  resetMotionPrefsStore()
})

describe('motion-prefs-store (§32.5 修订 10)', () => {
  it('defaults every lab effect on (2026-10-01 verdict)', () => {
    const state = useMotionPrefsStore.getState()
    expect(state.glow).toBe(true)
    expect(state.aurora).toBe(true)
    expect(state.windowTilt).toBe(true)
    expect(state.dockSheen).toBe(true)
    expect(state.themeGlow).toBe(true)
  })

  it('persists toggles to localStorage and reloads them', () => {
    useMotionPrefsStore.getState().setPref('aurora', false)
    useMotionPrefsStore.getState().setPref('glow', false)

    expect(useMotionPrefsStore.getState().aurora).toBe(false)
    expect(JSON.parse(localStorage.getItem('agehaos.motion.prefs.v1') ?? '{}')).toMatchObject({
      aurora: false,
      glow: false,
    })

    // 持久化值优先于默认：新页面加载（reload，不清存储）不丢用户裁决。
    reloadMotionPrefsStore()
    expect(useMotionPrefsStore.getState().aurora).toBe(false)
    expect(useMotionPrefsStore.getState().glow).toBe(false)
    expect(useMotionPrefsStore.getState().dockSheen).toBe(true)
  })

  it('sanitizes corrupt or partial stored shapes back to defaults', () => {
    localStorage.setItem('agehaos.motion.prefs.v1', '{"aurora":"yes","glow":true}')
    resetMotionPrefsStore()
    const state = useMotionPrefsStore.getState()
    expect(state.aurora).toBe(true) // 非布尔回落默认
    expect(state.glow).toBe(true)

    localStorage.setItem('agehaos.motion.prefs.v1', 'not-json')
    resetMotionPrefsStore()
    expect(useMotionPrefsStore.getState().themeGlow).toBe(true)
  })
})
