import { useEffect, useRef, useSyncExternalStore } from 'react'

import { useTranslation } from '@/core/i18n'
import type { WindowInstance } from '@/core/window'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

import {
  getClosingGhosts,
  subscribeClosingGhosts,
} from './closing-ghosts'
import { startSpaceTransition, type SpaceTransitionDirection } from './window-motion'
import { SnapPreviewOverlay } from './SnapPreviewOverlay'
import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const { t } = useTranslation()
  const windows = useWindowStore((s) => s.windows)
  // W3 Space 渲染过滤（审计 .tmp/spaces-audit.md §6）：过滤=可见性非卸载——
  // 非活跃 Space 的窗口保持挂载（hidden 类，见 WindowFrame spaceHidden），
  // iframe/应用状态存活，切换不销毁窗口。
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const ghosts = useSyncExternalStore(subscribeClosingGhosts, getClosingGhosts)
  const stageRef = useRef<HTMLElement | null>(null)
  const previousSpaceRef = useRef<string | null>(null)
  const transitionRef = useRef<Animation | null>(null)

  // 按 id 稳定排序渲染：层叠由每个窗口的 zIndex 样式决定，DOM 顺序不参与——
  // 若按 z 序渲染，focus 提交会 insertBefore 移动节点，打断正在进行的点击
  // 事件序列（pointerdown 命中按钮、mousedown 却落到 body，onClick 丢失）。
  const stableOrder = [...windows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // 退场 ghost（DESIGN.md §12）：store 已提交关闭，快照壳继续播完退场动画；
  // 同 key 复用组件实例与 DOM（内容连续），aria-hidden 不与后续定位器抢可达树。
  // ghost 携带自身 ghost 标记：不受 Space 过滤影响，永远可见播完退场（§6）。
  const withGhosts: Array<{ win: WindowInstance; ghost: boolean }> = [
    ...stableOrder.map((win) => ({ win, ghost: false })),
    ...ghosts.map((entry) => ({ win: entry.win, ghost: true })),
  ]

  // 独立层叠上下文：窗口 zIndex 只在层内比较。常态 z-30——压不过任务栏 /
  // 顶栏 / 左右浮层栏（z-40 chrome）与 toast / 搜索面板（z-50）；容器本身
  // 不吃指针事件（桌面图标 z-10 在其下方需可点），每个窗口自行恢复
  // pointer-events-auto。存在最大化窗口时整层抬到 z-[45]（§32.5 修订 12：
  // 最大化 = 整视口真全屏，盖过菜单栏/Dock/浮层栏全部 chrome）——抬整层而
  // 非单窗口，因为层叠上下文内无法逾越容器的 z；ghost 一并计入（关窗退场
  // 期间不回落，避免层闪）。W3：抬层判定只统计当前 Space（他 Space 的最大
  // 化窗不得抬层，ghost 豁免过滤照旧计入）。
  const maximizedActive = withGhosts.some(
    ({ win, ghost }) => win.state === 'maximized' && (ghost || win.spaceId === activeSpaceId),
  )

  // Space 切换进场动效（W3，审计 §6）：挂既有 WAAPI 体系（window-motion.ts）
  // ——容器级 transform+opacity 方向感淡入，不与单窗 open/close/genie 飞行
  // 共享元素（规避 ActiveFlight 单槽互踩）。方向感 = 目标 index 相对前 Space
  // index；只播进场（离场即时 hidden），reduced-motion/WAAPI 缺失直切（返回
  // null）；首次挂载无「切换」语义不播。落定即 cancel：fill:both 的终帧会
  // 压住级联（同 use-window-motion 落定纪律）。
  useEffect(() => {
    const previous = previousSpaceRef.current
    previousSpaceRef.current = activeSpaceId
    const stage = stageRef.current
    if (!stage || previous === null || previous === activeSpaceId) return
    const spaces = useSpaceStore.getState().spaces
    const fromIndex = spaces.find((space) => space.id === previous)?.index
    const toIndex = spaces.find((space) => space.id === activeSpaceId)?.index
    const direction: SpaceTransitionDirection =
      fromIndex !== undefined && toIndex !== undefined && toIndex < fromIndex
        ? 'backward'
        : 'forward'
    transitionRef.current?.cancel()
    const anim = startSpaceTransition(stage, direction)
    if (!anim) return
    transitionRef.current = anim
    anim.finished
      .then(() => {
        if (transitionRef.current === anim) transitionRef.current = null
        anim.cancel()
      })
      .catch(() => {})
    return () => {
      transitionRef.current?.cancel()
    }
  }, [activeSpaceId])

  return (
    <main
      ref={stageRef}
      aria-label={t('desktop.windowsLabel')}
      className={`pointer-events-none absolute inset-0 ${maximizedActive ? 'z-[45]' : 'z-30'}`}
      // 空间化舞台（2026-10-10）：perspective 供深度档/悬停浮起的 3D 上下文。
      // 静止布局零影响：perspective 只建立投影上下文，自身不参与布局，常态
      // 下子元素无 z≠0 变换（窗口深度在窗口作用域解析为非变换表达，见
      // spatial.css sp-win 段），投影因子恒 1；2D 变换（开合飞行/失焦退后）
      // 在 z=0 下投影因子同为 1。E2E 几何探针按静止态测量，读数不变。
      style={{ perspective: 'var(--sp-perspective)' }}
    >
      {/* W5 Snap Preview（审计 .tmp/spaces-audit.md §8）：层内首子元素 +
          zIndex:0（引擎窗 zIndex 从 1 起）——预览永远层内最低 z；rect=null
          时零 DOM。存在最大化窗整层抬 z-[45] 时预览仍在层内最低，无需特判。 */}
      <SnapPreviewOverlay />
      {withGhosts.map(({ win, ghost }) => (
        <WindowFrame
          key={win.id}
          win={win}
          ghost={ghost}
          spaceHidden={!ghost && win.spaceId !== activeSpaceId}
        />
      ))}
    </main>
  )
}
