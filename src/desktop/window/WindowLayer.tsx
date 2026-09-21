import type { WindowInstance } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows)

  return (
    <div className="absolute inset-x-0 top-0 bottom-12">
      {windows.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} />
      ))}
    </div>
  )
}
