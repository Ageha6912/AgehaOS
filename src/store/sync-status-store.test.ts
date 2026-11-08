import { beforeEach, describe, expect, it } from 'vitest'

import {
  reduceSyncCycle,
  resetSyncStatusForTests,
  useSyncStatusStore,
  type SyncStatusSnapshot,
} from './sync-status-store'

const INITIAL: SyncStatusSnapshot = { phase: 'idle', lastSuccessAt: null, lastErrorAt: null }

describe('reduceSyncCycle（状态流转映射）', () => {
  it('begin: idle → syncing，时间戳不动；重复 begin 返回原引用', () => {
    const begun = reduceSyncCycle(INITIAL, { type: 'begin' })
    expect(begun).toEqual({ phase: 'syncing', lastSuccessAt: null, lastErrorAt: null })

    const again = reduceSyncCycle(begun, { type: 'begin' })
    expect(again).toBe(begun)
  })

  it('success: syncing → idle 并记录成功时刻，保留 lastErrorAt 历史', () => {
    const failed: SyncStatusSnapshot = { phase: 'error', lastSuccessAt: 100, lastErrorAt: 200 }
    const recovered = reduceSyncCycle(failed, { type: 'success', at: 300 })
    expect(recovered).toEqual({ phase: 'idle', lastSuccessAt: 300, lastErrorAt: 200 })

    // 从未成功过（lastSuccessAt null）也能落定。
    const first = reduceSyncCycle({ phase: 'syncing', lastSuccessAt: null, lastErrorAt: null }, { type: 'success', at: 5 })
    expect(first).toEqual({ phase: 'idle', lastSuccessAt: 5, lastErrorAt: null })
  })

  it('failure: → error 并记录失败时刻，保留 lastSuccessAt（失败时仍知上次成功）', () => {
    const failed = reduceSyncCycle({ phase: 'syncing', lastSuccessAt: 100, lastErrorAt: null }, { type: 'failure', at: 250 })
    expect(failed).toEqual({ phase: 'error', lastSuccessAt: 100, lastErrorAt: 250 })
  })

  it('begin 不清历史：error 相再度 begin 仍保留两个时间戳', () => {
    const begun = reduceSyncCycle({ phase: 'error', lastSuccessAt: 100, lastErrorAt: 200 }, { type: 'begin' })
    expect(begun).toEqual({ phase: 'syncing', lastSuccessAt: 100, lastErrorAt: 200 })
  })
})

describe('useSyncStatusStore', () => {
  beforeEach(() => {
    resetSyncStatusForTests()
  })

  it('完整周期：begin → success 落定成功；随后 begin → failure 落定失败且保留成功时刻', () => {
    const store = useSyncStatusStore.getState()
    store.beginSyncCycle()
    expect(useSyncStatusStore.getState().phase).toBe('syncing')

    store.completeSyncCycle(1000)
    expect(useSyncStatusStore.getState()).toMatchObject({ phase: 'idle', lastSuccessAt: 1000, lastErrorAt: null })

    useSyncStatusStore.getState().beginSyncCycle()
    useSyncStatusStore.getState().failSyncCycle(2000)
    expect(useSyncStatusStore.getState()).toMatchObject({ phase: 'error', lastSuccessAt: 1000, lastErrorAt: 2000 })
  })

  it('并发周期不互相吞结果：先结束的一方不把仍在飞的另一方标成 idle/error（C1 审查）', () => {
    useSyncStatusStore.getState().beginSyncCycle()
    useSyncStatusStore.getState().beginSyncCycle()

    useSyncStatusStore.getState().completeSyncCycle(1000)
    // 仍有一个周期在飞：phase 保持 syncing，成功时刻已记录。
    expect(useSyncStatusStore.getState()).toMatchObject({
      phase: 'syncing',
      lastSuccessAt: 1000,
      pending: 1,
    })

    useSyncStatusStore.getState().failSyncCycle(2000)
    expect(useSyncStatusStore.getState()).toMatchObject({
      phase: 'error',
      lastSuccessAt: 1000,
      lastErrorAt: 2000,
      pending: 0,
    })
  })

  it('多余的终态事件不会把 pending 压成负数', () => {
    useSyncStatusStore.getState().completeSyncCycle(10)
    expect(useSyncStatusStore.getState()).toMatchObject({ phase: 'idle', pending: 0 })
    useSyncStatusStore.getState().failSyncCycle(20)
    expect(useSyncStatusStore.getState()).toMatchObject({ phase: 'error', pending: 0 })
  })

  it('resetSyncStatusForTests 回到出厂 idle / 双 null', () => {
    useSyncStatusStore.getState().beginSyncCycle()
    useSyncStatusStore.getState().failSyncCycle(7)
    resetSyncStatusForTests()
    // getState() 含 action 函数，三状态字段用 toMatchObject 钉值。
    expect(useSyncStatusStore.getState()).toMatchObject({ phase: 'idle', lastSuccessAt: null, lastErrorAt: null })
  })
})
