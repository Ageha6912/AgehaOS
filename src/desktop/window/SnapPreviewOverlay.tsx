import { useSyncExternalStore } from 'react'

import { getSnapPreview, subscribeSnapPreview } from './snap-preview'

/**
 * W5 Snap Preview Overlay（审计 .tmp/spaces-audit.md §8）。
 *
 * 渲染于 WindowLayer 的 <main> 内首子元素 + zIndex:0（引擎窗 zIndex 从 1
 * 起，window-manager.ts）——吸附预览永远在层内最低 z，存在最大化窗时整层
 * 抬 z-[45] 预览仍在层内最低（无需特判）。rect=null 返回 null（零 DOM 零
 * 重排——无拖拽时本组件不在可达树也不在布局树）；aria-hidden + 继承容器
 * pointer-events-none（不进可达树、不截胡指针/定位器）。
 *
 * 内联 left/top/width/height=rect：工作区带坐标与窗口同坐标系（审计 §1
 * snap 坐标系裁决），rect 直接来自 calculateSnapGeometry 产物（snap-preview
 * 单一来源）——E2E 探针据此断言预览与松手后窗口几何像素级一致。
 *
 * 视觉全走既有 token（禁高饱和蓝、禁新 hex/散落 shadow）：border-subtle
 * 细边 + --ag-scrim 背景（bg-scrim）+ .glass-hint（blur sm hint，降级环境
 * 自然消失）+ 圆角对齐窗口档（--sp-window-radius，spatial.css 32px 档）。
 * 尺寸过渡 120ms（--ag-motion-fast ≤200ms 档）；prefers-reduced-motion 直切
 * 由 index.css 全局 0.01ms 塌缩 media query 承接（§35.5，不进 WAAPI）。
 */
export function SnapPreviewOverlay() {
  const { rect } = useSyncExternalStore(subscribeSnapPreview, getSnapPreview)
  if (!rect) return null
  return (
    <div
      aria-hidden="true"
      data-testid="snap-preview"
      className="pointer-events-none absolute glass-hint rounded-[var(--sp-window-radius)] border border-border-subtle bg-scrim transition-[left,top,width,height] [transition-duration:var(--ag-motion-fast)] [transition-timing-function:var(--ag-motion-ease)]"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex: 0,
      }}
    />
  )
}
