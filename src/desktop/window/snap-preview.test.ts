import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSnapPreview,
  getSnapPreview,
  resetSnapPreview,
  setSnapPreview,
  subscribeSnapPreview,
} from './snap-preview'

const RECT = { x: 80, y: 32, width: 472, height: 736 }
const OTHER = { x: 532, y: 32, width: 472, height: 736 }

beforeEach(() => {
  resetSnapPreview()
})

describe('snap-preview（W5 模块级预览态，审计 .tmp/spaces-audit.md §8）', () => {
  it('set 后快照携带 rect；clear 回 null', () => {
    expect(getSnapPreview().rect).toBeNull()
    setSnapPreview(RECT)
    expect(getSnapPreview().rect).toEqual(RECT)
    clearSnapPreview()
    expect(getSnapPreview().rect).toBeNull()
  })

  it('重复 set 相同几何幂等：不替换快照、不通知', () => {
    setSnapPreview(RECT)
    const snapshot = getSnapPreview()
    const notify = vi.fn()
    const unsubscribe = subscribeSnapPreview(notify)
    setSnapPreview({ ...RECT }) // 值相等的新对象也幂等
    expect(getSnapPreview()).toBe(snapshot) // 引用稳定 → useSyncExternalStore 零重渲染
    expect(notify).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('set 不同几何：不可变替换 + 通知（旧快照不被篡改）', () => {
    setSnapPreview(RECT)
    const first = getSnapPreview()
    const notify = vi.fn()
    const unsubscribe = subscribeSnapPreview(notify)
    setSnapPreview(OTHER)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(getSnapPreview().rect).toEqual(OTHER)
    expect(getSnapPreview()).not.toBe(first)
    expect(first.rect).toEqual(RECT) // 旧快照保持不变
    unsubscribe()
  })

  it('clear 已空幂等：不通知', () => {
    const notify = vi.fn()
    const unsubscribe = subscribeSnapPreview(notify)
    clearSnapPreview()
    expect(notify).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('订阅通知：set 与 clear 都广播，退订后不再收', () => {
    const notify = vi.fn()
    const unsubscribe = subscribeSnapPreview(notify)
    setSnapPreview(RECT)
    clearSnapPreview()
    expect(notify).toHaveBeenCalledTimes(2)
    unsubscribe()
    setSnapPreview(OTHER)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('set 的入参防御：外部篡改原对象不影响内部快照', () => {
    const rect = { ...RECT }
    setSnapPreview(rect)
    rect.x = 999
    expect(getSnapPreview().rect?.x).toBe(RECT.x)
  })

  it('resetSnapPreview：测试隔离出口回到 null', () => {
    setSnapPreview(RECT)
    resetSnapPreview()
    expect(getSnapPreview().rect).toBeNull()
  })

  it('reset 后监听者收到通知（隔离出口不悬挂订阅方）', () => {
    setSnapPreview(RECT)
    const notify = vi.fn()
    const unsubscribe = subscribeSnapPreview(notify)
    resetSnapPreview()
    expect(notify).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})

afterEach(() => {
  resetSnapPreview()
})
