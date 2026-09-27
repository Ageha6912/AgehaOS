import { useSyncExternalStore } from 'react'

import type { WindowInstance } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import {
  getClosingGhosts,
  subscribeClosingGhosts,
} from './closing-ghosts'
import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows)
  const ghosts = useSyncExternalStore(subscribeClosingGhosts, getClosingGhosts)

  // 按 id 稳定排序渲染：层叠由每个窗口的 zIndex 样式决定，DOM 顺序不参与——
  // 若按 z 序渲染，focus 提交会 insertBefore 移动节点，打断正在进行的点击
  // 事件序列（pointerdown 命中按钮、mousedown 却落到 body，onClick 丢失）。
  const stableOrder = [...windows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // 退场 ghost（DESIGN.md §12）：store 已提交关闭，快照壳继续播完退场动画；
  // 同 key 复用组件实例与 DOM（内容连续），aria-hidden 不与后续定位器抢可达树。
  const withGhosts = [...stableOrder, ...ghosts.map((entry) => entry.win)]

  return (
    // 独立层叠上下文（z-30）：窗口 zIndex 只在层内比较，永远压不过任务栏
    // （z-40，自动隐藏悬浮层）、toast / 搜索面板（z-50）。容器本身不吃指针
    // 事件（桌面图标 z-10 在其下方需可点）；每个窗口自行恢复
    // pointer-events-auto。任务栏不再占高，窗口层铺满整个视口。
    <div className="pointer-events-none absolute inset-0 z-30">
      {withGhosts.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} ghost={!windows.some((w) => w.id === win.id)} />
      ))}
    </div>
  )
}
