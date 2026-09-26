import type { WindowInstance } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows)

  return (
    // 独立层叠上下文（z-30）：窗口 zIndex 只在层内比较，永远压不过任务栏
    // （z-40，自动隐藏悬浮层）、toast / 搜索面板（z-50）。容器本身不吃指针
    // 事件（桌面图标 z-10 在其下方需可点）；每个窗口自行恢复
    // pointer-events-auto。任务栏不再占高，窗口层铺满整个视口。
    <div className="pointer-events-none absolute inset-0 z-30">
      {windows.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} />
      ))}
    </div>
  )
}
