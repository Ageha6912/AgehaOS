import { memo, type PointerEvent as ReactPointerEvent } from 'react'

import { X } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import type { WindowState } from '@/core/window'

import { WindowCardFace } from '@/desktop/window-card-face'

/**
 * Mission Control 轻量窗口卡片（Window Management 2.0 W7，审计
 * .tmp/spaces-audit.md §10；W11 增补右上角 ❌ 关闭钮，审计 §13 B①）：卡面=
 * AppIcon + 标题 + **CSS 拟态窗脸**——禁渲染应用内容、禁 iframe clone、禁
 * 截图（硬性设计决定 3），窗口的组件树全程在 WindowLayer 里原地不动（W3
 * 过滤是可见性级），卡片只是指针代理。
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
 * - ❌ 关闭钮（W11 审计 §13 B①）：卡片 button **不能嵌套 button**（HTML
 *   约束），故包一层 relative 定位容器、关闭钮做兄弟节点绝对定位右上角。
 *   **容器不得设 pointer-events-auto**（继承卡片区 pointer-events-none）——
 *   拖拽中 elementFromPoint 要穿过原卡直达下方 Space 胶囊（W7 复核修复的
 *   命中语义），可点击性由卡片/关闭钮各自 pointer-events-auto 自持。关闭钮
 *   onPointerDown/click stopPropagation：绝不让指针序列进卡片激活/拖拽簿记
 *   （防御性——兄弟结构下本就不会命中卡片 handler，结构再演进也不破）。
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
  /** ❌ 关闭钮回调（W11）：容器裁决=useWindowStore close 该窗，卡随退场消失。 */
  onClose: (win: CardWindow) => void
}

/**
 * 卡面主体（AppIcon+标题+拟态窗脸）：自真机反馈第三轮起提取为共享组件
 * WindowCardFace（src/desktop/window-card-face.tsx）——WindowCard、
 * WindowDragGhost 与 Alt+W 窗口切换器条目三方共同消费，卡面改一处即全体
 * 对齐（「向任务视图对齐、大小一致」的单一来源）。此处仅按 CardWindow
 * 快照转发 props，类名/结构原样（MC 视觉零变化）。
 */
function CardFace({ win }: { win: CardWindow }) {
  return (
    <WindowCardFace
      appId={win.appId}
      title={win.title}
      minimized={win.state === 'minimized'}
    />
  )
}

function WindowCardImpl({
  win,
  dragging = false,
  onPointerDown,
  onActivate,
  onClose,
}: WindowCardProps) {
  const { t } = useTranslation()
  return (
    // 定位容器：宽度档从卡面按钮上移到这里；pointer-events 保持继承卡片区
    // 的 none（见文件头命中语义说明），可点击性由内部两个 button 自持。
    // 真机反馈第二轮（F4 视觉）：w-44(176px)→w-56(224px) 放大一档——卡面
    // 内部全是 w-full/比例宽（h-24 窗脸、w-3/4 占位条），无 w-44 硬编码
    // 依赖，高度随拟态窗脸比例自适应；拖拽影（下）同步同宽保持同款。
    <div className="relative w-56 shrink-0">
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
        className={`flex w-full flex-col items-center gap-2 rounded-xl border p-3 text-left transition-shadow select-none touch-none ${
          dragging
            ? 'pointer-events-none border-border-strong opacity-40'
            : 'pointer-events-auto border-border-subtle shadow-soft hover:shadow-float'
        } surface-glass`}
      >
        <CardFace win={win} />
      </button>
      {/* ❌ 关闭钮（W11 审计 §13 B①）：h-6 w-6 级小钮，常态弱化呈现（border-subtle
          + muted 前景，hover 提亮）与卡片拟态窗脸协调；拖拽中一并 pointer-events-none
          （原卡整体惰性，落点语义归拖拽影）。aria-label 走既有 window.close 词典键。 */}
      <button
        type="button"
        data-testid="mission-control-card-close"
        data-window-id={win.id}
        aria-label={t('window.close')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClose(win)
        }}
        className={`absolute -right-2 -top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-surface-soft text-text-muted shadow-soft hover:text-text ${
          dragging ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
      >
        <X size={12} weight="bold" />
      </button>
    </div>
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
      className="pointer-events-none flex w-56 shrink-0 flex-col items-center gap-2 rounded-xl border border-border-strong p-3 shadow-popover surface-glass"
    >
      <CardFace win={win} />
    </div>
  )
})

/** memo 卡片：容器拖拽重渲染时未动卡的 props 不变即跳过（审计 §10 决定 4）。 */
export const WindowCard = memo(WindowCardImpl)
