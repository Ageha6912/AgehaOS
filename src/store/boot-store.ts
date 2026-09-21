import { create } from 'zustand'

export type BootPhase = 'booting' | 'loading' | 'ready'

interface BootState {
  phase: BootPhase
  setPhase: (phase: BootPhase) => void
  advance: () => void
}

const NEXT_PHASE: Record<Exclude<BootPhase, 'ready'>, BootPhase> = {
  booting: 'loading',
  loading: 'ready',
}

export const useBootStore = create<BootState>((set) => ({
  phase: 'booting',
  setPhase: (phase) => set({ phase }),
  advance: () =>
    set((state) => ({
      phase: state.phase === 'ready' ? state.phase : NEXT_PHASE[state.phase],
    })),
}))
