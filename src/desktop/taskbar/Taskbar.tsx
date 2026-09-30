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
 * 自动隐藏 Dock（docs/DESIGN.md §9/§20）：默认藏于屏幕底缘之外，指针触底
 * （或键盘焦点进入 Dock 控件）后 300ms 缓滑入场；指针离开 Dock 子树（含
 * 菜单/预览等浮层，它们都是 footer 的 DOM 子孙）400ms 后滑出。
 * 全宽 footer 只是透明运动层；视觉本体是居中悬浮玻璃胶囊（Calm Future，
 * 2026-09-30 Slice 4）。行为契约（reveal/hide/波浪/锚点）与 §9 完全一致。
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
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex h-[calc(var(--ag-dock-height)+0.75rem)] items-end justify-center px-3 pb-3 transition-transform duration-300 ease-out"
        style={{ transform: revealed ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* 悬浮胶囊 Dock（DESIGN.md §20）：全宽 footer 只是运动层（透明、
            pointer-events-none 不截胡两侧窗口点击，坑 40）；玻璃胶囊本体
            接指针。自动隐藏/波浪/预览/锚点契约全部不变（§9/§13）。 */}
        <div className="surface-glass pointer-events-auto flex h-16 max-w-[calc(100%-1.5rem)] items-center gap-1 self-end rounded-full border border-border px-2 shadow-popover">
          <AppLauncher />
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />

          {/* self-stretch：裁剪盒抬到整条胶囊高（64px），波浪放大不出框
              （坑 13 的 overflow 隐式裁剪）；按钮节距恒 48px（w-11 + gap-1），
              是 σ44 波浪几何的前提（§13）。 */}
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
                    className={`relative flex h-10 w-11 items-center justify-center rounded-lg text-sm ${
                      active
                        ? 'bg-surface-raised text-text'
                        : win.state === 'minimized'
                          ? 'text-text-muted/70 hover:bg-surface-raised hover:text-text'
                          : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    }`}
                    onClick={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                  >
                    <span aria-hidden="true" data-wave-icon className="flex">
                      <AppIcon appId={win.appId} size={24} />
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
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
        </div>

        {/* 尾部系统状态（通知/用户/时钟）已随顶栏上线迁移至 MenuBar
            （docs/DESIGN.md §19，2026-09-30 Q3 裁决）——任务栏回归纯应用 Dock。 */}
      </footer>
    </>
  )
}
