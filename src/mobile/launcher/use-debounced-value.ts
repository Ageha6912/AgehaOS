import { useEffect, useState } from 'react'

/**
 * 防抖值 hook（M4-1 启动器文件域）：value 连续变化只在停满 delayMs 后落地
 * 一次（计时器随每次变化重置）；初值即 value（首帧零延迟）。未到的计时器
 * 由 effect cleanup 撤销——卸载或再变化时清掉，绝不向已卸载组件 setState。
 * 「何时落地」全部在 useEffect 时序里，无可抽纯函数——hook 契约由
 * use-debounced-value.test.tsx 以 fake timers 钉住（初值零延迟 / 停满才落
 * 地 / 连续变化只落最后一次 / 卸载安全）。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
