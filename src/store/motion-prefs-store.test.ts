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
    // 2026-10-10 空间化裁决 3：常驻环境浮动动画默认开，可在设置关。
    expect(state.spatialMotion).toBe(true)
  })

  it('persists toggles to localStorage and reloads them', () => {
    useMotionPrefsStore.getState().setPref('aurora', false)
    useMotionPrefsStore.getState().setPref('glow', false)
    useMotionPrefsStore.getState().setPref('spatialMotion', false)

    expect(useMotionPrefsStore.getState().aurora).toBe(false)
    expect(JSON.parse(localStorage.getItem('agehaos.motion.prefs.v1') ?? '{}')).toMatchObject({
      aurora: false,
      glow: false,
      spatialMotion: false,
    })

    // 持久化值优先于默认：新页面加载（reload，不清存储）不丢用户裁决。
    reloadMotionPrefsStore()
    expect(useMotionPrefsStore.getState().aurora).toBe(false)
    expect(useMotionPrefsStore.getState().glow).toBe(false)
    expect(useMotionPrefsStore.getState().dockSheen).toBe(true)
    expect(useMotionPrefsStore.getState().spatialMotion).toBe(false)
  })

  it('sanitizes corrupt or partial stored shapes back to defaults', () => {
    localStorage.setItem('agehaos.motion.prefs.v1', '{"aurora":"yes","glow":true}')
    resetMotionPrefsStore()
    const state = useMotionPrefsStore.getState()
    expect(state.aurora).toBe(true) // 非布尔回落默认
    expect(state.glow).toBe(true)

    // 旧版本存储缺 spatialMotion 字段：回落默认（true），不丢档。
    // reload（不清存储）= 「新页面加载」语义：合法布尔保留、缺席字段补默认
    // ——reset 是清存储的测试隔离出口（removeItem + load），会把存储键抹掉，
    // 断言的保留语义（glow:false 存活）必须走 reload（同上例 :33-38）。
    localStorage.setItem('agehaos.motion.prefs.v1', '{"glow":false}')
    reloadMotionPrefsStore()
    expect(useMotionPrefsStore.getState().glow).toBe(false)
    expect(useMotionPrefsStore.getState().spatialMotion).toBe(true)

    localStorage.setItem('agehaos.motion.prefs.v1', 'not-json')
    resetMotionPrefsStore()
    expect(useMotionPrefsStore.getState().themeGlow).toBe(true)
  })
})
