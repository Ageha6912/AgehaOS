import { useSyncExternalStore } from 'react'

import { useTranslation } from '@/core/i18n'
import type { WindowInstance } from '@/core/window'
import { useWindowStore } from '@/store/window-store'

import {
  getClosingGhosts,
  subscribeClosingGhosts,
} from './closing-ghosts'
import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const { t } = useTranslation()
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
  // pointer-events-auto。存在最大化窗口时整层抬到 z-[45]（§32.5 修订 12：
  // 最大化 = 整视口真全屏，盖过菜单栏/Dock/浮层栏全部 chrome）——抬整层而
  // 非单窗口，因为层叠上下文内无法逾越容器的 z；ghost 一并计入（关窗退场
  // 期间不回落，避免层闪）。
  const maximizedActive = withGhosts.some((win) => win.state === 'maximized')

  return (
    <main
      aria-label={t('desktop.windowsLabel')}
      className={`pointer-events-none absolute inset-0 ${maximizedActive ? 'z-[45]' : 'z-30'}`}
      // 空间化舞台（2026-10-10）：perspective 供深度档/悬停浮起的 3D 上下文。
      // 静止布局零影响：perspective 只建立投影上下文，自身不参与布局，常态
      // 下子元素无 z≠0 变换（窗口深度在窗口作用域解析为非变换表达，见
      // spatial.css sp-win 段），投影因子恒 1；2D 变换（开合飞行/失焦退后）
      // 在 z=0 下投影因子同为 1。E2E 几何探针按静止态测量，读数不变。
      style={{ perspective: 'var(--sp-perspective)' }}
    >
      {withGhosts.map((win: WindowInstance) => (
        <WindowFrame key={win.id} win={win} ghost={!windows.some((w) => w.id === win.id)} />
      ))}
    </main>
  )
}
