import type { WindowInstance } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows)

  return (
    // 独立层叠上下文（z-30）：窗口 zIndex 只在层内比较，永远压不过任务栏
    // （z-40）、toast / 搜索面板（z-50）——否则第 N 个窗口会盖住任务栏。
    <div className="absolute inset-x-0 top-0 bottom-12 z-30">
      {windows.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} />
      ))}
    </div>
  )
}
