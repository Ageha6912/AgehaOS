import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedValue } from './use-debounced-value'

/**
 * 防抖值 hook 契约（M4-1 文件域输入，fake timers 钉时序）：
 * - 初值零延迟（首帧即 value）；
 * - 变化后停满 delayMs 才落地（差 1ms 不落地）；
 * - 连续变化重置计时器，只有最后一次停顿落地（中间值永不出现）；
 * - 卸载撤销未到计时器（cleanup 清理，不向已卸载组件 setState）。
 */
describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初值零延迟：首帧即 value，不等待 delayMs', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 200))
    expect(result.current).toBe('a')
  })

  it('变化后停满 delayMs 才落地：差 1ms 仍是旧值', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    expect(result.current).toBe('a')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })
    expect(result.current).toBe('a')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current).toBe('b')
  })

  it('连续变化重置计时器：只有最后一次的停顿落地，中间值永不出现', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )

    rerender({ value: 'b' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    rerender({ value: 'c' })

    // 距 'c' 150ms < 200ms：'b' 的计时器已被重置吞掉，'c' 也未到。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(result.current).toBe('a')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(result.current).toBe('c')
  })

  it('卸载撤销未到计时器：cleanup 清理后推进时间不报错', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(result.current).toBe('a')
  })
})
