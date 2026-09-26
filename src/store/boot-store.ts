import { create } from 'zustand'

export type BootPhase = 'booting' | 'loading' | 'ready' | 'login'

interface BootState {
  phase: BootPhase
  /**
   * 开机覆盖层退场是否已收尾（DESIGN.md §11）：进度完成 → finishBoot 切换到
   * 目的界面，但 BootScreen 仍挂载播放退场动画；引擎收尾后置 true，App 据此卸载。
   */
  layerExitDone: boolean
  setPhase: (phase: BootPhase) => void
  /** booting → loading, then the caller decides ready vs login (PRD §24.1). */
  advance: () => void
  finishBoot: (target: 'ready' | 'login') => void
  markLayerExitDone: () => void
}

const NEXT_PHASE: Record<'booting', BootPhase> = {
  booting: 'loading',
}

export const useBootStore = create<BootState>((set) => ({
  phase: 'booting',
  layerExitDone: false,
  setPhase: (phase) => set({ phase }),
  advance: () =>
    set((state) => ({
      phase: state.phase === 'booting' ? NEXT_PHASE.booting : state.phase,
    })),
  // 引擎的 skip() 可能在进度越过状态切换点之前触发：booting 直接完成同样有效。
  finishBoot: (target) =>
    set((state) =>
      state.phase === 'booting' || state.phase === 'loading' ? { phase: target } : state,
    ),
  markLayerExitDone: () => set({ layerExitDone: true }),
}))
