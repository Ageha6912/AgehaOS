import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  closeAppHistoryEntry,
  closeOverlayHistoryEntry,
  consumeMobileHistoryLayer,
  consumeSuppressedPop,
  pushAppHistoryEntry,
  pushOverlayHistoryEntry,
  resetMobileHistoryForTests,
  syncOverlayHistory,
} from './mobile-history'

/**
 * history 分层栈记账契约（F1/F2 审查修复）：应用栈位至多一条、覆盖层按打
 * 开序叠栈、UI 关闭只消费栈顶、从覆盖层进入应用走 replaceState 改写。
 * popstate 的消费接线归 MobileAppHost.test.tsx；这里钉纯记账层（jsdom 的
 * history 只实现 push/replace，back 用 spy 断言调用次数）。
 */
beforeEach(() => {
  resetMobileHistoryForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMobileHistoryForTests()
})

describe('mobile-history', () => {
  it('应用栈位：push 一条并写 agehaMobileApp 标记；应用间切换只更新标记不叠栈', () => {
    const lengthBefore = window.history.length
    pushAppHistoryEntry('com.ageha.calculator')
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(window.history.state?.agehaMobileApp).toBe('com.ageha.calculator')

    pushAppHistoryEntry('com.ageha.notes')
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(window.history.state?.agehaMobileApp).toBe('com.ageha.notes')
  })

  it('覆盖层栈位：push 一条并写 agehaMobileOverlay 标记；重复 push 不叠', () => {
    const lengthBefore = window.history.length
    pushOverlayHistoryEntry('notifications')
    pushOverlayHistoryEntry('notifications')
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(window.history.state?.agehaMobileOverlay).toBe('notifications')
  })

  it('从覆盖层进入应用视图：覆盖层栈位被改写成应用栈位（不新增历史条目）', () => {
    const lengthBefore = window.history.length
    pushOverlayHistoryEntry('launcher')
    expect(window.history.length).toBe(lengthBefore + 1)

    pushAppHistoryEntry('com.ageha.files')
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(window.history.state?.agehaMobileApp).toBe('com.ageha.files')

    // 栈里只剩应用层（覆盖层记账已被改写替换）。
    expect(consumeMobileHistoryLayer()).toEqual({ kind: 'app', appId: 'com.ageha.files' })
    expect(consumeMobileHistoryLayer()).toBeNull()
  })

  it('UI 关闭栈顶层：history.back 一次 + 抑制自己触发的 popstate', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    pushAppHistoryEntry('com.ageha.calculator')
    pushOverlayHistoryEntry('recents')

    closeOverlayHistoryEntry('recents')
    expect(backSpy).toHaveBeenCalledTimes(1)
    expect(consumeSuppressedPop()).toBe(true)
    expect(consumeSuppressedPop()).toBe(false)

    closeAppHistoryEntry()
    expect(backSpy).toHaveBeenCalledTimes(2)
    expect(consumeSuppressedPop()).toBe(true)
  })

  it('同步：先补应用栈位，再摘除已关闭覆盖层；栈序 = 打开序（LIFO 消费）', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    pushAppHistoryEntry('com.ageha.calculator')
    syncOverlayHistory(['launcher'])
    expect(backSpy).not.toHaveBeenCalled()

    syncOverlayHistory([])
    expect(backSpy).toHaveBeenCalledTimes(1)

    // 消费序：先压入的层先被 pop（栈顶 = 最后打开）。
    syncOverlayHistory(['recents', 'notifications'])
    expect(consumeMobileHistoryLayer()).toEqual({ kind: 'overlay', overlay: 'notifications' })
    expect(consumeMobileHistoryLayer()).toEqual({ kind: 'overlay', overlay: 'recents' })
    expect(consumeMobileHistoryLayer()).toEqual({
      kind: 'app',
      appId: 'com.ageha.calculator',
    })
    expect(consumeMobileHistoryLayer()).toBeNull()
  })
})
