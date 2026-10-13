import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { startSpaceFocusTracking, stopSpaceFocusTracking } from './space-focus'

/**
 * W3 active window 按 Space 记忆（审计 .tmp/spaces-audit.md §6）四态钉扎：
 * focused 记忆 / switched 恢复记住窗 / 目标窗已关回落栈顶 / 空 Space 不聚焦。
 * 全程走真实 systemBus + 真实 store（事件驱动模块，不 hook 组件）。
 *
 * 记忆写入延后一个微任务（create 的 window.focused 早于 store commit，见
 * space-focus.ts handler 注释）——断言前 `await flushMemory()` 清微任务队列。
 */

beforeEach(() => {
  stopSpaceFocusTracking()
  resetWindowStore()
  resetSpaceStore()
})

/** 让排队的记忆写入微任务落定（一次 await 即可：FIFO，handler 内全同步）。 */
async function flushMemory(): Promise<void> {
  await Promise.resolve()
}

function spaceById(id: string) {
  return useSpaceStore.getState().spaces.find((space) => space.id === id)
}

function winById(id: string) {
  return useWindowStore.getState().windows.find((win) => win.id === id)
}

describe('space-focus（activeWindowId 按 Space 记忆）', () => {
  it('focused 记忆：window.focused 属当前 Space 时 setActiveWindow 落位（含 create 的早发事件）', async () => {
    startSpaceFocusTracking()

    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事二' })
    await flushMemory()

    // create() 聚焦新窗（事件先于 store commit，微任务侧按落定快照判守卫）：
    // 记忆跟随最后一次聚焦。
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(second)
    useWindowStore.getState().focus(first)
    await flushMemory()
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first)
  })

  it('其他 Space 的 window.focused 不记忆（minimize/close 的 focusTopmost 跨 Space 补焦点守卫）', async () => {
    startSpaceFocusTracking()
    const otherId = useSpaceStore.getState().createSpace('其他')

    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件', spaceId: otherId })
    const third = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事三' })
    await flushMemory()
    // third 聚焦中被最小化 → focusTopmost 全局补焦点落到 other 的文件窗。
    useWindowStore.getState().minimize(third)
    await flushMemory()

    // 守卫：other Space 的补焦点（focusTopmost 选中 z 最高的 other 文件窗）不落
    // 记忆；default 的记忆停在最后被聚焦的本 Space 窗口 third（first 从未再被聚焦）。
    expect(spaceById(otherId)?.activeWindowId).toBeNull()
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(third)
    expect(winById(third)?.state).toBe('minimized')
  })

  it('switched 恢复记住窗：记忆窗 minimized → restore+focus 组合（taskbar 同款）', async () => {
    startSpaceFocusTracking()
    const workId = useSpaceStore.getState().createSpace('工作')

    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事二' })
    await flushMemory()
    // 最小化被聚焦的 second：focusTopmost 补到 first；再最小化 first 时无窗可补，
    // 记忆停在已最小化的 first 上——切回时正是 restore+focus 组合的用武之地。
    useWindowStore.getState().minimize(second)
    useWindowStore.getState().minimize(first)
    await flushMemory()
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first)

    useSpaceStore.getState().switchSpace(workId)
    useSpaceStore.getState().switchSpace(DEFAULT_SPACE_ID)
    await flushMemory()

    expect(winById(first)?.state).toBe('normal')
    expect(winById(first)?.focused).toBe(true)
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first)
  })

  it('目标窗已关回落栈顶：记忆窗死亡时聚焦目标 Space zIndex 最大的可见窗', async () => {
    startSpaceFocusTracking()
    const workId = useSpaceStore.getState().createSpace('工作')

    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事二' })
    await flushMemory()
    useWindowStore.getState().focus(first) // 记忆停在 first
    const third = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件', spaceId: workId }) // 全局焦点漂到 third
    await flushMemory()
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first)

    useSpaceStore.getState().switchSpace(workId) // 回落：work 的可见栈顶 = third
    await flushMemory()
    expect(winById(third)?.focused).toBe(true)
    useSpaceStore.getState().switchSpace(DEFAULT_SPACE_ID) // 记忆 first 存活 → 拉回焦点
    await flushMemory()
    expect(winById(first)?.focused).toBe(true)

    // 关掉被聚焦的 first：focusTopmost 全局补焦点落到 work 的 third（守卫不落
    // default 记忆）→ default 记忆悬在已关闭的 first 上。
    useWindowStore.getState().close(first)
    await flushMemory()
    expect(winById(third)?.focused).toBe(true)
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first)

    useSpaceStore.getState().switchSpace(workId)
    useSpaceStore.getState().switchSpace(DEFAULT_SPACE_ID)
    await flushMemory()

    // 记忆窗已死 → 回落 default 的 zIndex 最大可见窗 = second；回落 focus 的
    // 微任务按落定快照把记忆一并收敛到 second。
    expect(winById(second)?.focused).toBe(true)
    expect(winById(third)?.focused).toBe(false)
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(second)
  })

  it('空 Space 不聚焦：切入空 Space 不动任何窗口焦点、记忆保持 null', async () => {
    startSpaceFocusTracking()
    const workId = useSpaceStore.getState().createSpace('工作')
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    await flushMemory()

    useSpaceStore.getState().switchSpace(workId)
    await flushMemory()

    expect(spaceById(workId)?.activeWindowId).toBeNull()
    expect(winById(first)?.focused).toBe(true) // 空目标 Space 不抢焦点
    expect(useWindowStore.getState().windows.every((win) => win.spaceId !== workId)).toBe(true)
  })

  it('记忆窗被 moveWindowToSpace 改派后不跨 Space 拉焦点（存活但仍属原 Space 才恢复）', async () => {
    startSpaceFocusTracking()
    const workId = useSpaceStore.getState().createSpace('工作')
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    await flushMemory()
    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first)

    useWindowStore.getState().moveWindowToSpace(first, workId)
    useSpaceStore.getState().switchSpace(workId) // work 记忆 null → 回落可见栈顶 = first
    await flushMemory()
    expect(winById(first)?.focused).toBe(true)
    useSpaceStore.getState().switchSpace(DEFAULT_SPACE_ID) // default 记忆 first 已改派 → 不跨 Space 聚焦
    await flushMemory()

    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBe(first) // 记忆字段不动（restore 时校验）
    expect(winById(first)?.focused).toBe(true) // 焦点在 work 栈顶 first——default 回落无可见窗，不另抢
  })

  it('start 幂等、stop 清订阅：stop 后不再记忆（含排队的微任务写入）', async () => {
    startSpaceFocusTracking()
    startSpaceFocusTracking()
    stopSpaceFocusTracking()

    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    await flushMemory()

    expect(spaceById(DEFAULT_SPACE_ID)?.activeWindowId).toBeNull()
  })
})
