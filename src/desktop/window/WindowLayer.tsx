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

  // 独立层叠上下文：窗口 zIndex 只在层内比较。常态 z-30——压不过任务栏 /
  // 顶栏 / 左右浮层栏（z-40 chrome）与 toast / 搜索面板（z-50）；容器本身
  // 不吃指针事件（桌面图标 z-10 在其下方需可点），每个窗口自行恢复
  // pointer-events-auto。存在最大化窗口时整层抬到 z-[45]（2026-10-01 用户
  // 裁决：最大化窗口必须盖过左栏/小组件栏等全部桌面组件）——抬整层而非单
  // 窗口，因为层叠上下文内无法逾越容器的 z；ghost 一并计入（关窗退场期间
  // 不回落，避免层闪）。最大化几何止于菜单栏下界与 Dock 边界，与两者无
  // 空间重叠，Dock/顶栏照常可用。
  const maximizedActive = withGhosts.some((win) => win.state === 'maximized')

  return (
    <div className={`pointer-events-none absolute inset-0 ${maximizedActive ? 'z-[45]' : 'z-30'}`}>
      {withGhosts.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} ghost={!windows.some((w) => w.id === win.id)} />
      ))}
    </div>
  )
}
