import { memo, type PointerEvent as ReactPointerEvent } from 'react'

import { AppIcon } from '@/apps/app-icon'
import type { WindowState } from '@/core/window'

/**
 * Mission Control 轻量窗口卡片（Window Management 2.0 W7，审计
 * .tmp/spaces-audit.md §10）：卡面=AppIcon + 标题 + **CSS 拟态窗脸**——
 * 禁渲染应用内容、禁 iframe clone、禁截图（硬性设计决定 3），窗口的组件树
 * 全程在 WindowLayer 里原地不动（W3 过滤是可见性级），卡片只是指针代理。
 *
 * - React.memo：拖拽期间容器逐 pointermove 重渲染，未拖动卡的 props（win
 *   引用/回调/标志）逐字节不变即跳过——20+ 窗可用的性能纪律（决定 4）。
 * - 拖拽视觉=transform-only 跟手（决定 3 禁布局动画）：跟手位移由容器下发
 *   到**根层拖拽影**（WindowDragGhost，渲染在 MissionControl 根层 fixed
 *   容器内，脱离卡片区 overflow-y-auto 裁剪——W7 复核修复）；原卡在拖拽中
 *   `pointer-events-none` + 半透明留位提示，自身零位移/零布局写入。
 * - 点击激活语义（restore/focus、跨 Space 先 switchSpace）由容器裁决；卡片
 *   只上报 `onActivate(win)`——拖拽后的合成 click 由容器按拖拽态抑制（拖拽
 *   落点不是点击），卡片不感知抑制策略。
 */

/** 卡片条目快照（只认这组字段，不持有 WindowInstance 全量）。 */
export interface CardWindow {
  id: string
  appId: string
  title: string
  state: WindowState
  spaceId: string
}

export interface WindowCardProps {
  win: CardWindow
  /** 该卡正处于拖拽中（容器 pointermove 已越过阈值）：原卡 pointer-events-none + 半透明留位。 */
  dragging?: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, win: CardWindow) => void
  onActivate: (win: CardWindow) => void
}

/** 卡面主体（AppIcon+标题+拟态窗脸）：WindowCard 与 WindowDragGhost 共用。 */
function CardFace({ win }: { win: CardWindow }) {
  return (
    <>
      <span className="flex w-full items-center gap-2">
        <AppIcon appId={win.appId} size={22} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text" title={win.title}>
          {win.title}
        </span>
      </span>
      {/* CSS 拟态窗脸（禁应用内容/禁 iframe clone/禁截图）：红黄绿窗控点 +
          两根内容占位条，全部 aria-hidden 纯装饰。 */}
      <span
        aria-hidden="true"
        className={`flex h-24 w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-soft ${
          win.state === 'minimized' ? 'opacity-50' : ''
        }`}
      >
        <span className="flex items-center gap-1 border-b border-border-subtle px-1.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-wl-close" />
          <span className="h-1.5 w-1.5 rounded-full bg-wl-min" />
          <span className="h-1.5 w-1.5 rounded-full bg-wl-max" />
        </span>
        <span className="flex flex-1 flex-col gap-1 p-1.5">
          <span className="h-1.5 w-3/4 rounded-full bg-border-strong" />
          <span className="h-1.5 w-1/2 rounded-full bg-border-subtle" />
        </span>
      </span>
    </>
  )
}

function WindowCardImpl({
  win,
  dragging = false,
  onPointerDown,
  onActivate,
}: WindowCardProps) {
  return (
    <button
      type="button"
      data-testid="mission-control-card"
      data-window-id={win.id}
      data-space-id={win.spaceId}
      data-minimized={win.state === 'minimized' || undefined}
      data-dragging={dragging || undefined}
      aria-label={win.title}
      onPointerDown={(event) => onPointerDown(event, win)}
      onClick={() => onActivate(win)}
      // 拖拽中原卡（W7 复核修复）：`pointer-events-none` 让 elementFromPoint
      // 穿过它命中下方胶囊（drop 结束恢复 auto）；`opacity-40` 半透明=原位
      // 提示。跟手视觉已移交根层拖拽影（WindowDragGhost）——原卡不再带
      // transform 跟手，也就不会被卡片区 overflow-y-auto 裁出「上缘切断」，
      // 命中测试不再依赖 overflow 裁剪副作用。
      className={`flex w-44 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 text-left transition-shadow select-none touch-none ${
        dragging
          ? 'pointer-events-none border-border-strong opacity-40'
          : 'pointer-events-auto border-border-subtle shadow-soft hover:shadow-float'
      } surface-glass`}
    >
      <CardFace win={win} />
    </button>
  )
}

/**
 * 拖拽影（W7 复核修复：跟手视觉脱离裁剪容器）：与卡面同款（AppIcon+标题+
 * 拟态窗脸）的轻量只读影，由容器渲染在 MissionControl 根层 fixed 容器内、
 * z 高于内容岛——不受卡片区 overflow-y-auto 滚动裁剪。影与所在层全程
 * `pointer-events-none`，elementFromPoint 天然穿过它命中下方 Space 胶囊；
 * 位移由容器经 transform 下发（transform-only 跟手、抓取点恒在光标下），
 * 自身禁布局属性写入、无任何可交互元素。
 */
export const WindowDragGhost = memo(function WindowDragGhost({ win }: { win: CardWindow }) {
  return (
    <div
      data-testid="mission-control-drag-ghost"
      aria-hidden="true"
      className="pointer-events-none flex w-44 shrink-0 flex-col items-center gap-2 rounded-xl border border-border-strong p-3 shadow-popover surface-glass"
    >
      <CardFace win={win} />
    </div>
  )
})

/** memo 卡片：容器拖拽重渲染时未动卡的 props 不变即跳过（审计 §10 决定 4）。 */
export const WindowCard = memo(WindowCardImpl)
