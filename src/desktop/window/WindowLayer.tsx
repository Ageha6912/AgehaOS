import type { WindowInstance } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows)

  return (
    // 独立层叠上下文（z-30）：窗口 zIndex 只在层内比较，永远压不过任务栏
    // （z-40）、toast / 搜索面板（z-50）——否则第 N 个窗口会盖住任务栏。
    // 容器本身不吃指针事件（桌面图标 z-10 在其下方需可点）；每个窗口
    // 自行恢复 pointer-events-auto。
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-12 z-30">
      {windows.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} />
      ))}
    </div>
  )
}
