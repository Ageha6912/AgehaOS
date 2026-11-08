import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/core/i18n'

import { zoomAt, type ImageZoomState } from './image-preview'

const MIN_SCALE = 0.1
const MAX_SCALE = 40
/** 按钮步进；滚轮用 e^-Δy·0.0015 的连续系数（手感对齐主流看图器）。 */
const BUTTON_STEP = 1.25
const WHEEL_SENSITIVITY = 0.0015

export interface ImagePreviewProps {
  src: string
  name: string
  narrow: boolean
}

/**
 * 图片预览面（open-claude-ui 的光标不动点 Pan/Zoom 算法落地）：
 * 滚轮以光标为不动点缩放、拖拽平移、双击复位、按钮定步进（触屏入口）。
 * 滚轮用原生非 passive 监听（React 根部 wheel 为 passive，preventDefault 无效）；
 * 拖拽用 setPointerCapture 防指针滑出丢移。
 */
export function ImagePreview({ src, name, narrow }: ImagePreviewProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState<ImageZoomState>({ scale: 1, tx: 0, ty: 0 })
  const [dragging, setDragging] = useState(false)
  const [broken, setBroken] = useState(false)
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      setZoom((current) =>
        zoomAt(current, {
          factor: Math.exp(-event.deltaY * WHEEL_SENSITIVITY),
          originX: event.clientX - rect.left,
          originY: event.clientY - rect.top,
          centerX: rect.width / 2,
          centerY: rect.height / 2,
          minScale: MIN_SCALE,
          maxScale: MAX_SCALE,
        }),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const stepZoom = (factor: number): void => {
    const el = containerRef.current
    const rect = el?.getBoundingClientRect()
    const centerX = (rect?.width ?? 0) / 2
    const centerY = (rect?.height ?? 0) / 2
    setZoom((current) =>
      zoomAt(current, {
        factor,
        originX: centerX,
        originY: centerY,
        centerX,
        centerY,
        minScale: MIN_SCALE,
        maxScale: MAX_SCALE,
      }),
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="files-image-preview"
      className={`relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden bg-surface-raised ${
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // 缩放胶囊/按钮自己消费指针（D1 审查）：容器一旦 setPointerCapture，
        // pointerup 被重定向到容器、click 目标也变容器，+/− 按钮在鼠标下
        // 完全失效（触屏 tap 不受影响，故旧单测没抓到）。
        if (event.target instanceof Element && event.target.closest('button') !== null) return
        dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
        setDragging(true)
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* jsdom 无活动指针表：捕获失败不阻断平移 */
        }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        setZoom((current) => ({
          ...current,
          tx: current.tx + (event.clientX - drag.lastX),
          ty: current.ty + (event.clientY - drag.lastY),
        }))
        dragRef.current = { ...drag, lastX: event.clientX, lastY: event.clientY }
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* 同上 */
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        // 捕获被浏览器收回（窗口失焦/手势中断）：兜底复位平移态。
        dragRef.current = null
        setDragging(false)
      }}
      onDoubleClick={() => setZoom({ scale: 1, tx: 0, ty: 0 })}
    >
      {broken ? (
        <div className="flex max-h-full max-w-full items-center justify-center rounded-md border border-border bg-surface px-6 py-4 text-sm text-text-dimmed">
          {t('files.preview.broken')}
        </div>
      ) : (
      <img
        src={src}
        alt={name}
        draggable={false}
        onError={() => setBroken(true)}
        className="max-h-full max-w-full"
        style={{
          transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
          transformOrigin: 'center',
        }}
      />
      )}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface-elevated/95 px-1 shadow-window">
        {/* §35.1 材质纪律：共享应用不自带 blur 面——胶囊用实色兜底，不挂 backdrop-blur。 */}
        <button
          type="button"
          data-testid="files-image-zoom-out"
          aria-label={t('files.preview.zoomOut')}
          className={`flex items-center justify-center rounded-full text-text-muted hover:bg-surface-raised hover:text-text ${
            narrow ? 'h-11 w-11' : 'h-7 w-7'
          }`}
          onClick={() => stepZoom(1 / BUTTON_STEP)}
        >
          −
        </button>
        <span
          data-testid="files-image-zoom-level"
          className="min-w-11 text-center text-[11px] tabular-nums text-text-muted"
        >
          {Math.round(zoom.scale * 100)}%
        </span>
        <button
          type="button"
          data-testid="files-image-zoom-in"
          aria-label={t('files.preview.zoomIn')}
          className={`flex items-center justify-center rounded-full text-text-muted hover:bg-surface-raised hover:text-text ${
            narrow ? 'h-11 w-11' : 'h-7 w-7'
          }`}
          onClick={() => stepZoom(BUTTON_STEP)}
        >
          +
        </button>
      </div>
    </div>
  )
}
