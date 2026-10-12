import { create } from 'zustand'

/**
 * 云同步状态面 store（M4-3）：settings-sync / file-sync 对外汇报的最小信号
 * 单一来源——「一次与云端和解（cycle）」的 begin / success / failure 三相 +
 * 最近成功 / 最近失败两个时间戳。store 只记录结果，不参与任何重试、防抖或
 * 合并决策（ADR 17 三方合并与各服务的推送策略原样不动）；「未登录 / 开关
 * 关闭 / 本地认证模式」等准入状态刻意**不入库**——它们由同步设置区从
 * session-store 与同步开关（isSyncEnabled）实时派生展示，避免第二事实源。
 */

export type SyncPhase = 'idle' | 'syncing' | 'error'

export interface SyncStatusSnapshot {
  readonly phase: SyncPhase
  readonly lastSuccessAt: number | null
  readonly lastErrorAt: number | null
}

export type SyncCycleEvent =
  | { type: 'begin' }
  | { type: 'success'; at: number }
  | { type: 'failure'; at: number }

/**
 * 状态流转映射（纯函数，单测逐跳钉死）：
 * - begin：进入 syncing；已在 syncing 时原引用返回（重复 begin 不动时间戳）。
 * - success：回 idle 并刷新 lastSuccessAt；**保留** lastErrorAt（历史由 UI
 *   按 phase 决定展示，failure 相以「上次成功」副行呈现它）。
 * - failure：置 error 并刷新 lastErrorAt；保留 lastSuccessAt（失败时仍能
 *   说出上一次成功是什么时候）。
 */
export function reduceSyncCycle(state: SyncStatusSnapshot, event: SyncCycleEvent): SyncStatusSnapshot {
  switch (event.type) {
    case 'begin':
      return state.phase === 'syncing' ? state : { ...state, phase: 'syncing' }
    case 'success':
      return { phase: 'idle', lastSuccessAt: event.at, lastErrorAt: state.lastErrorAt }
    case 'failure':
      return { phase: 'error', lastSuccessAt: state.lastSuccessAt, lastErrorAt: event.at }
  }
}

interface SyncStatusStore extends SyncStatusSnapshot {
  beginSyncCycle: () => void
  completeSyncCycle: (at: number) => void
  failSyncCycle: (at: number) => void
}

export const useSyncStatusStore = create<SyncStatusStore>()((set) => ({
  phase: 'idle',
  lastSuccessAt: null,
  lastErrorAt: null,
  beginSyncCycle: () => set((state) => reduceSyncCycle(state, { type: 'begin' })),
  completeSyncCycle: (at) => set((state) => reduceSyncCycle(state, { type: 'success', at })),
  failSyncCycle: (at) => set((state) => reduceSyncCycle(state, { type: 'failure', at })),
}))

/** 测试间隔离（session-store 的 resetSessionStore 同款独立出口）。 */
export function resetSyncStatusForTests(): void {
  useSyncStatusStore.setState({ phase: 'idle', lastSuccessAt: null, lastErrorAt: null })
}
