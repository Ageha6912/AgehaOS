import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useClock } from './use-clock'

/**
 * use-clock 迁移（M1-1）后的行为回归：纯路径原样从
 * src/desktop/taskbar/use-clock.ts 迁入 src/components/use-clock.ts（供
 * 桌面菜单栏/右栏与移动状态栏共用），逻辑零改动——用假时钟钉住格式与
 * 每秒走针。
 */
describe('useClock（迁移后回归）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按 locale 输出 24 小时制 hh:mm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 14, 5, 0))
    const { result } = renderHook(() => useClock())
    expect(result.current).toBe('14:05')
  })

  it('每秒走针（interval 1000ms 推进读数）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 14, 59, 58))
    const { result } = renderHook(() => useClock())
    expect(result.current).toBe('14:59')
    act(() => {
      vi.advanceTimersByTime(2100)
    })
    expect(result.current).toBe('15:00')
  })
})
