import { useEffect, useRef, useState } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { WindowPreview } from './WindowPreview'
import { useDockWave } from './use-dock-wave'

const HOVER_DELAY_MS = 350
/** 移出后到收起的缓冲，给「滑到悬停预览/菜单」留路径。 */
const HIDE_DELAY_MS = 400

/**
 * 自动隐藏任务栏（docs/DESIGN.md §9）：默认藏于屏幕底缘之外，指针触底
 * （或键盘焦点进入任务栏控件）后 300ms 缓滑入场；指针离开任务栏子树
 * （含菜单/预览等浮层，它们都是 footer 的 DOM 子孙）400ms 后滑出。
 * 背景不再使用玻璃面板——只有一条随主题的底部渐变纱（from-bg/85），
 * 视觉上「透明」地融进壁纸，同时保住深浅壁纸下的文字可读性。
 */
export function Taskbar() {
  const windows = useWindowStore((s) => s.windows)
  const focus = useWindowStore((s) => s.focus)
  const minimize = useWindowStore((s) => s.minimize)
  const restore = useWindowStore((s) => s.restore)

  const [revealed, setRevealed] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [anchorLeft, setAnchorLeft] = useState(0)
  const hoverTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  // 任务栏波浪（DESIGN.md §13）：高斯距离衰减放大，只写 data-wave-icon 的
  // transform，不碰按钮与 reveal/hide 的 pointerenter/leave 链。
  const waveRowRef = useRef<HTMLDivElement | null>(null)
  useDockWave(waveRowRef)

  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    },
    [],
  )

  const cancelHide = (): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }
  const reveal = (): void => {
    cancelHide()
    setRevealed(true)
  }
  const scheduleHide = (): void => {
    cancelHide()
    hideTimer.current = window.setTimeout(() => setRevealed(false), HIDE_DELAY_MS)
  }

  const toggleWindow = (id: string, focused: boolean, minimized: boolean) => {
    if (minimized) restore(id)
    else if (focused) minimize(id)
    else focus(id)
  }

  const startHover = (id: string): void => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHoveredId(id), HOVER_DELAY_MS)
  }
  const endHover = (): void => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHoveredId(null)
  }

  return (
    <>
      {/* 底缘唤出区：压在窗口层之上（z-30）但让位于弹层（z-50）。
          离开唤出区也要安排收起——指针静止时滑入的 footer 不会收到
          pointerenter（hover 链只在指针移动时刷新），直接跳走时只有
          唤出区的 leave 可靠触发隐藏；footer 的 enter 会取消它。 */}
      <div
        aria-hidden="true"
        data-testid="taskbar-reveal-zone"
        className="fixed inset-x-0 bottom-0 z-40 h-1.5"
        onPointerEnter={reveal}
        onPointerLeave={scheduleHide}
      />

      <footer
        data-state={revealed ? 'revealed' : 'hidden'}
        onPointerEnter={reveal}
        onPointerLeave={scheduleHide}
        onFocusCapture={reveal}
        onBlurCapture={(event) => {
          // 焦点仍在任务栏子树内（进入菜单项等）不收起。
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          scheduleHide()
        }}
        className="absolute inset-x-0 bottom-0 z-40 flex h-12 items-center gap-2 bg-gradient-to-t from-bg/85 via-bg/45 to-transparent px-2 transition-transform duration-300 ease-out"
        style={{ transform: revealed ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <AppLauncher />

        {/* self-stretch：裁剪盒抬到整条任务栏高（48px），波浪放大不出框（坑 13 的
            overflow 隐式裁剪）；波浪引擎挂这里，只动图标不动按钮。 */}
        <div
          ref={waveRowRef}
          className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto"
        >
          {windows.map((win) => {
            const active = win.focused && win.state !== 'minimized'
            return (
              <div
                key={win.id}
                className="relative"
                onMouseEnter={(event) => {
                  setAnchorLeft(event.currentTarget.getBoundingClientRect().left)
                  startHover(win.id)
                }}
                onMouseLeave={endHover}
              >
                <button
                  type="button"
                  aria-label={win.title}
                  data-testid={`taskbar-item-${win.id}`}
                  className={`relative flex h-9 w-11 items-center justify-center rounded-md text-sm ${
                    active
                      ? 'bg-surface-raised text-text'
                      : win.state === 'minimized'
                        ? 'text-text-muted/70 hover:bg-surface-raised hover:text-text'
                        : 'text-text-muted hover:bg-surface-raised hover:text-text'
                  }`}
                  onClick={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                >
                  <span aria-hidden="true" data-wave-icon className="flex">
                    <AppIcon appId={win.appId} size={20} />
                  </span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary"
                    />
                  )}
                </button>

                {hoveredId === win.id && (
                  <WindowPreview
                    win={win}
                    anchorLeft={anchorLeft}
                    onSwitch={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                    onClose={() => {
                      useWindowStore.getState().close(win.id)
                      endHover()
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* 尾部系统状态（通知/用户/时钟）已随顶栏上线迁移至 MenuBar
            （docs/DESIGN.md §19，2026-09-30 Q3 裁决）——任务栏回归纯应用 Dock。 */}
      </footer>
    </>
  )
}
