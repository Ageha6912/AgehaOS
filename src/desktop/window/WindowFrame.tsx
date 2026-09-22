import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

import { componentFor } from '@/apps/builtin'
import { MissingApp } from '@/apps/placeholder-app'
import { useTranslation } from '@/core/i18n'
import type { WindowInstance } from '@/core/window'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { useWindowStore } from '@/store/window-store'

import { getWorkspaceViewport } from './viewport'

interface DragOrigin {
  pointerX: number
  pointerY: number
  x: number
  y: number
}

interface ResizeOrigin {
  pointerX: number
  pointerY: number
  width: number
  height: number
}

/**
 * Title-bar buttons must not reach the header's drag handler: it captures the
 * pointer, which would retarget the click away from the button.
 */
function swallowPointerDown(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation()
}

export function WindowFrame({ win }: { win: WindowInstance }) {
  const { t } = useTranslation()
  const focus = useWindowStore((s) => s.focus)
  const close = useWindowStore((s) => s.close)
  const minimize = useWindowStore((s) => s.minimize)
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize)
  const move = useWindowStore((s) => s.move)
  const resize = useWindowStore((s) => s.resize)

  const dragOrigin = useRef<DragOrigin | null>(null)
  const resizeOrigin = useRef<ResizeOrigin | null>(null)

  const maximized = win.state === 'maximized'
  const minimized = win.state === 'minimized'
  const app = componentFor(win.appId)

  const style: CSSProperties = maximized
    ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex }

  const onTitlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    focus(win.id)
    if (maximized || event.button !== 0) return
    dragOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: win.x,
      y: win.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onTitlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = dragOrigin.current
    if (!origin) return
    move(
      win.id,
      origin.x + (event.clientX - origin.pointerX),
      origin.y + (event.clientY - origin.pointerY),
      getWorkspaceViewport(),
    )
  }

  const onTitlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragOrigin.current) return
    dragOrigin.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* pointer capture was already released */
    }
  }

  const onResizeHandlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    focus(win.id)
    resizeOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: win.width,
      height: win.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onResizeHandlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = resizeOrigin.current
    if (!origin) return
    resize(
      win.id,
      origin.width + (event.clientX - origin.pointerX),
      origin.height + (event.clientY - origin.pointerY),
      getWorkspaceViewport(),
    )
  }

  const onResizeHandlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!resizeOrigin.current) return
    resizeOrigin.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* pointer capture was already released */
    }
  }

  return (
    <section
      aria-label={win.title}
      className={`absolute flex flex-col overflow-hidden border bg-surface ${minimized ? 'hidden' : ''} ${
        maximized ? 'rounded-none' : 'rounded-md'
      } ${win.focused ? 'border-primary/50 shadow-window' : 'border-border'}`}
      style={style}
      onPointerDown={() => focus(win.id)}
    >
      <header
        className={`flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-surface-raised px-3 ${
          maximized ? 'cursor-default' : 'cursor-move'
        }`}
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onDoubleClick={() => {
          if (win.resizable) toggleMaximize(win.id)
        }}
      >
        <span className={`truncate text-sm ${win.focused ? 'text-text' : 'text-text-muted'}`}>
          {win.title}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={t('window.minimize')}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-xs text-text-muted hover:bg-surface hover:text-text"
            onPointerDown={swallowPointerDown}
            onClick={() => minimize(win.id)}
          >
            –
          </button>
          {win.resizable && (
            <button
              type="button"
              aria-label={maximized ? t('window.restore') : t('window.maximize')}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-xs text-text-muted hover:bg-surface hover:text-text"
              onPointerDown={swallowPointerDown}
              onClick={() => toggleMaximize(win.id)}
            >
              {maximized ? '❐' : '□'}
            </button>
          )}
          {win.closable && (
            <button
              type="button"
              aria-label={t('window.close')}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-xs text-text-muted hover:bg-red-500/80 hover:text-white"
              onPointerDown={swallowPointerDown}
              onClick={() => close(win.id)}
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <AppErrorBoundary appId={win.appId} windowId={win.id}>
          {app ? <app.Component windowId={win.id} /> : <MissingApp windowId={win.id} />}
        </AppErrorBoundary>
      </div>

      {win.resizable && !maximized && (
        <div
          role="presentation"
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          onPointerDown={onResizeHandlePointerDown}
          onPointerMove={onResizeHandlePointerMove}
          onPointerUp={onResizeHandlePointerUp}
        />
      )}
    </section>
  )
}
