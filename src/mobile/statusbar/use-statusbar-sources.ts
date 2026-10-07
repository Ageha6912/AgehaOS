import { useEffect, useState } from 'react'

import { batterySourceOf, networkSourceOf } from './sources'
import type { BatterySource, NetworkSource } from './sources'

/**
 * 移动状态栏数据源 hooks（M1-1）：把 sources.ts 的纯探测接成响应式读数。
 * 能力不可用（getBattery / connection 缺席）恒返回 null——组件侧 null 即
 * 不渲染，杜绝假数据（DESIGN.md §0.5）。电池订阅 levelchange、网络订阅
 * online/offline 与 connection.change，读数实时跟随系统，不是一次性快照。
 */

/** 电池电量百分比（0–100）；API 不可用为 null。 */
export function useBatteryLevel(): number | null {
  const [level, setLevel] = useState<number | null>(null)
  useEffect(() => {
    const getBattery = batterySourceOf(window.navigator)
    if (!getBattery) return
    let battery: BatterySource | null = null
    let cancelled = false
    const sync = (): void => setLevel(Math.round((battery?.level ?? 0) * 100))
    getBattery()
      .then((value) => {
        if (cancelled) return
        battery = value
        sync()
        value.addEventListener('levelchange', sync)
      })
      .catch(() => {
        /* 取电池失败（权限/实现差异）：保持 null 隐藏，不伪造 */
      })
    return () => {
      cancelled = true
      battery?.removeEventListener('levelchange', sync)
    }
  }, [])
  return level
}

/** 网络读数（onLine + effectiveType）；connection API 不可用为 null。 */
export function useNetworkState(): NetworkSource | null {
  const [state, setState] = useState<NetworkSource | null>(() =>
    networkSourceOf(window.navigator),
  )
  useEffect(() => {
    const sync = (): void => setState(networkSourceOf(window.navigator))
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    const connection = (
      window.navigator as Navigator & {
        connection?: { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void }
      }
    ).connection
    connection?.addEventListener?.('change', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      connection?.removeEventListener?.('change', sync)
    }
  }, [])
  return state
}
