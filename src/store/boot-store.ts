import { create } from 'zustand'

export type BootPhase = 'booting' | 'loading' | 'ready' | 'login'

interface BootState {
  phase: BootPhase
  setPhase: (phase: BootPhase) => void
  /** booting → loading, then the caller decides ready vs login (PRD §24.1). */
  advance: () => void
  finishBoot: (target: 'ready' | 'login') => void
}

const NEXT_PHASE: Record<'booting', BootPhase> = {
  booting: 'loading',
}

export const useBootStore = create<BootState>((set) => ({
  phase: 'booting',
  setPhase: (phase) => set({ phase }),
  advance: () =>
    set((state) => ({
      phase: state.phase === 'booting' ? NEXT_PHASE.booting : state.phase,
    })),
  finishBoot: (target) => set((state) => (state.phase === 'loading' ? { phase: target } : state)),
}))
