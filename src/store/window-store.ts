import { create } from 'zustand'

import { systemBus } from '@/core/events'
import { WindowManager } from '@/core/window'
import type { CreateWindowOptions, Viewport, WindowInstance } from '@/core/window'

interface WindowStoreState {
  windows: WindowInstance[]
  open: (options: CreateWindowOptions) => string
  close: (id: string) => void
  focus: (id: string) => void
  minimize: (id: string) => void
  toggleMaximize: (id: string) => void
  restore: (id: string) => void
  move: (id: string, x: number, y: number, viewport?: Viewport) => void
  resize: (id: string, width: number, height: number, viewport?: Viewport) => void
}

let engine = new WindowManager(systemBus)

export const useWindowStore = create<WindowStoreState>()((set) => {
  const commit = () => set({ windows: engine.list() })

  return {
    windows: [],

    open: (options) => {
      const win = engine.create(options)
      commit()
      return win.id
    },

    close: (id) => {
      engine.close(id)
      commit()
    },

    focus: (id) => {
      engine.focus(id)
      commit()
    },

    minimize: (id) => {
      engine.minimize(id)
      commit()
    },

    toggleMaximize: (id) => {
      const win = engine.get(id)
      if (!win) return
      if (win.state === 'maximized') engine.restore(id)
      else engine.maximize(id)
      commit()
    },

    restore: (id) => {
      engine.restore(id)
      commit()
    },

    move: (id, x, y, viewport) => {
      engine.move(id, x, y, viewport)
      commit()
    },

    resize: (id, width, height, viewport) => {
      engine.resize(id, width, height, viewport)
      commit()
    },
  }
})

/** Replaces the engine with a fresh one; used between tests. */
export function resetWindowStore(): void {
  engine = new WindowManager(systemBus)
  useWindowStore.setState({ windows: [] })
}
