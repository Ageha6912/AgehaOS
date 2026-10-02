import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

import { Minus, Square, X } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { MissingApp } from '@/apps/placeholder-app'
import { useTranslation } from '@/core/i18n'
import type { WindowInstance } from '@/core/window'
import { isAllowedWebAppEntry } from '@/core/apps/web-app'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { WebAppFrame } from '@/components/web-app-frame'
import { getAppManifest } from '@/store/app-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useWindowStore } from '@/store/window-store'

import { getWorkspaceViewport } from './viewport'
import { useWindowMotion } from './use-window-motion'
import { useFocusTilt } from '@/desktop/motion/use-focus-tilt'

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

/**
 * Type A（内置组件）之外的应用按 Type B 渲染：manifest entry 必须通过同源
 * `/apps/sites/` allowlist（§30.3 纵深防御的第二道闸；第一道在安装目录）。
 */
function TypeBOrMissing({ appId, title, windowId }: { appId: string; title: string; windowId: string }) {
  const manifest = getAppManifest(appId)
  if (manifest && isAllowedWebAppEntry(manifest.entry)) {
    return <WebAppFrame entry={manifest.entry} appId={appId} windowId={windowId} title={title} />
  }
  return <MissingApp windowId={windowId} />
}

export function WindowFrame({ win, ghost = false }: { win: WindowInstance; ghost?: boolean }) {
  const { t } = useTranslation()
  const focus = useWindowStore((s) => s.focus)
  const minimize = useWindowStore((s) => s.minimize)
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize)
  const move = useWindowStore((s) => s.move)
  const resize = useWindowStore((s) => s.resize)

  const sectionRef = useRef<HTMLElement | null>(null)
  // 窗口动效（DESIGN.md §12）：打开/关闭/genie 飞行 + 半途抓回；关闭走
  // requestClose（store 立即提交 + ghost 快照续播退场），最小化/还原由
  // store 状态迁移驱动。ghost = 关闭退场中的快照壳：不进可达树、不吃指针。
  const { requestClose } = useWindowMotion(win, sectionRef, { ghost })

  const dragOrigin = useRef<DragOrigin | null>(null)
  const resizeOrigin = useRef<ResizeOrigin | null>(null)

  const maximized = win.state === 'maximized'
  const minimized = win.state === 'minimized'
  const app = componentFor(win.appId)
  // 窗口切换转场（§32.5 修订 10）：聚焦小起立（一次性 WAAPI）+ 失焦微退后。
  const tiltOn = useMotionPrefsStore((s) => s.windowTilt)
  useFocusTilt(sectionRef, win.focused, minimized, tiltOn)

  // 最大化（2026-10-02 用户裁决，修订 12）：整视口真全屏——横向全幅贴左右
  // 屏幕边缘、上缘到屏幕顶（盖过菜单栏带）、下缘到屏幕底（盖过 Dock 带），
  // 不留任何系统栏带；菜单栏/Dock/左右浮层栏全部置于窗口层（z-[45]）之下，
  // 还原走窗口标题栏。几何改类驱动（断点条件无法走内联样式）；calc 任意值
  // 用下划线空格形式（坑 §25）。
  const style: CSSProperties = maximized
    ? { zIndex: win.zIndex }
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
      ref={sectionRef}
      aria-label={win.title}
      aria-hidden={ghost || undefined}
      className={`surface-glass glass-deep absolute flex flex-col overflow-hidden border ${minimized ? 'hidden' : ''} ${
        maximized
          ? 'inset-0 rounded-none'
          : 'rounded-xl'
      } ${
        win.focused
          ? 'border-primary/50 shadow-window'
          : 'border-border shadow-window-flat'
      } ${tiltOn && !win.focused && !minimized ? 'is-tilt-dim' : ''} ${
        ghost ? 'pointer-events-none' : 'pointer-events-auto'
      }`}
      style={style}
      onPointerDown={() => focus(win.id)}
    >
      <header
        className={`flex h-9 shrink-0 select-none items-center gap-2 border-b border-border-subtle px-3 ${
          maximized ? 'cursor-default' : 'cursor-move'
        }`}
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onDoubleClick={() => {
          if (win.resizable) toggleMaximize(win.id)
        }}
      >
        {/* 交通灯（Q4 裁决，左置；非激活时整体降不透明度，§21）。 */}
        <div className={`flex items-center gap-2 ${win.focused ? 'opacity-100' : 'opacity-60'}`}>
          {win.closable && (
            <button
              type="button"
              aria-label={t('window.close')}
              className="group/light flex h-6 w-6 items-center justify-center"
              onPointerDown={swallowPointerDown}
              onClick={requestClose}
            >
              <span
                aria-hidden="true"
                className="flex h-3 w-3 items-center justify-center rounded-full bg-wl-close"
              >
                <X
                  size={8}
                  weight="bold"
                  className="text-wl-close-glyph opacity-0 transition-opacity group-hover/light:opacity-100 group-focus-visible/light:opacity-100"
                />
              </span>
            </button>
          )}
          <button
            type="button"
            aria-label={t('window.minimize')}
            className="group/light flex h-6 w-6 items-center justify-center"
            onPointerDown={swallowPointerDown}
            onClick={() => minimize(win.id)}
          >
            <span
              aria-hidden="true"
              className="flex h-3 w-3 items-center justify-center rounded-full bg-wl-min"
            >
              <Minus
                size={8}
                weight="bold"
                className="text-wl-min-glyph opacity-0 transition-opacity group-hover/light:opacity-100 group-focus-visible/light:opacity-100"
              />
            </span>
          </button>
          {win.resizable && (
            <button
              type="button"
              aria-label={maximized ? t('window.restore') : t('window.maximize')}
              className="group/light flex h-6 w-6 items-center justify-center"
              onPointerDown={swallowPointerDown}
              onClick={() => toggleMaximize(win.id)}
            >
              <span
                aria-hidden="true"
                className="flex h-3 w-3 items-center justify-center rounded-full bg-wl-max"
              >
                <Square
                  size={7}
                  weight={maximized ? 'fill' : 'bold'}
                  className="text-wl-max-glyph opacity-0 transition-opacity group-hover/light:opacity-100 group-focus-visible/light:opacity-100"
                />
              </span>
            </button>
          )}
        </div>
        <AppIcon appId={win.appId} size={16} />
        <span className={`truncate text-sm ${win.focused ? 'text-text' : 'text-text-muted'}`}>
          {win.title}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <AppErrorBoundary appId={win.appId} windowId={win.id}>
          {app ? (
            <app.Component windowId={win.id} />
          ) : (
            <TypeBOrMissing appId={win.appId} title={win.title} windowId={win.id} />
          )}
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
