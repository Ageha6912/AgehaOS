import { useEffect, useRef, useState } from 'react'

import { Trash } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { requestFilesTrash } from '@/apps/app-deep-link'
import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { WindowPreview } from './WindowPreview'
import { useDockWave } from './use-dock-wave'

const HOVER_DELAY_MS = 350
/** 移出后到收起的缓冲，给「滑到悬停预览/菜单」留路径。 */
const HIDE_DELAY_MS = 400

/** 常驻瓷贴（§32 参考图 Dock 位；全部真实应用）。 */
const PINNED_APP_IDS = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.calculator',
  'com.ageha.terminal',
  'com.ageha.store',
  'com.ageha.settings',
] as const

/**
 * 自动隐藏 Dock（docs/DESIGN.md §9/§20 + §32 参考图对齐）：默认藏于屏幕
 * 底缘之外，指针触底（或键盘焦点进入 Dock 控件）后 300ms 缓滑入场；指针
 * 离开 Dock 子树（含菜单/预览等浮层，它们都是 footer 的 DOM 子孙）400ms
 * 后滑出。全宽 footer 只是透明运动层；视觉本体 = 居中悬浮玻璃胶囊，内容 =
 * 启动器 + 常驻瓷贴（files/notes/calculator/terminal/store/settings）+
 * 运行中窗口（波浪/悬停预览契约不变 §13/§12）+ 回收站（Files 深链）。
 */
export function Taskbar() {
  const { t } = useTranslation()
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

  /** 常驻瓷贴可达名：有窗口用窗口标题，无窗口用本地化应用名。 */
  const pinnedLabel = (appId: string): string => {
    const appWindows = windows.filter((win) => win.appId === appId)
    const latest = appWindows[appWindows.length - 1]
    if (latest) return latest.title
    const meta = componentFor(appId)
    return meta ? t(meta.titleKey) : appId
  }

  /** 常驻瓷贴激活语义：无窗口启动；有窗口恢复/聚焦/再点最小化。 */
  const activatePinned = (appId: string): void => {
    const appWindows = windows.filter((win) => win.appId === appId)
    if (appWindows.length === 0) {
      launchApp(appId)
      return
    }
    const target = appWindows[appWindows.length - 1]
    toggleWindow(target.id, target.focused, target.state === 'minimized')
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
      {/* 底缘唤出区：压在窗口层之上（z-40）但让位于弹层（z-50）。
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
        {/* 悬浮胶囊 Dock（§20/§32）：启动器 + 常驻瓷贴 + 运行中 + 回收站。
            自动隐藏/波浪/预览/锚点行为契约全部不变（§9/§13/§12）。 */}
        <div className="desktop-chrome surface-glass pointer-events-auto flex h-16 max-w-[calc(100%-1.5rem)] items-center gap-1 self-end rounded-full border border-border px-2 shadow-popover">
          <AppLauncher />
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />

          {/* 常驻瓷贴（§32 参考图 Dock 位；单实例激活语义 + 悬停预览同契约）。 */}
          <div className="flex items-center gap-1 self-stretch">
            {PINNED_APP_IDS.map((appId) => {
              const appWindows = windows.filter((win) => win.appId === appId)
              const latest = appWindows[appWindows.length - 1]
              const active = latest?.focused && latest.state !== 'minimized'
              return (
                <div
                  key={appId}
                  className="relative"
                  onMouseEnter={
                    latest
                      ? (event) => {
                          setAnchorLeft(event.currentTarget.getBoundingClientRect().left)
                          startHover(latest.id)
                        }
                      : undefined
                  }
                  onMouseLeave={endHover}
                >
                  <button
                    type="button"
                    data-testid={`dock-pin-${appId}`}
                    aria-label={pinnedLabel(appId)}
                    title={pinnedLabel(appId)}
                    className={`relative flex h-12 w-12 items-center justify-center rounded-xl ${
                      active ? 'bg-surface-raised' : 'hover:bg-surface-raised'
                    }`}
                    onClick={() => activatePinned(appId)}
                  >
                    <span aria-hidden="true" className="flex">
                      <AppIcon appId={appId} size={44} />
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>

                  {latest && hoveredId === latest.id && (
                    <WindowPreview
                      win={latest}
                      anchorLeft={anchorLeft}
                      onSwitch={() =>
                        toggleWindow(latest.id, latest.focused, latest.state === 'minimized')
                      }
                      onClose={() => {
                        useWindowStore.getState().close(latest.id)
                        endHover()
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* 运行中窗口（非常驻瓷贴的应用）：波浪/预览契约区。 */}
          {windows.some(
            (win) => !PINNED_APP_IDS.includes(win.appId as (typeof PINNED_APP_IDS)[number]),
          ) && <div aria-hidden="true" className="mx-0.5 h-8 w-px shrink-0 bg-border" />}
          <div
            ref={waveRowRef}
            className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto"
          >
            {windows.map((win) => {
              if (PINNED_APP_IDS.includes(win.appId as (typeof PINNED_APP_IDS)[number])) return null
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
                    className={`relative flex h-12 w-12 items-center justify-center rounded-xl text-sm ${
                      active
                        ? 'bg-surface-raised text-text'
                        : win.state === 'minimized'
                          ? 'text-text-muted/70 hover:bg-surface-raised hover:text-text'
                          : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    }`}
                    onClick={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                  >
                    <span aria-hidden="true" data-wave-icon className="flex">
                      <AppIcon appId={win.appId} size={44} />
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

          {/* 回收站（§32 参考图 Dock 末位）：Files 回收站视图深链。 */}
          <div aria-hidden="true" className="mx-0.5 h-8 w-px shrink-0 bg-border" />
          <button
            type="button"
            data-testid="dock-trash"
            aria-label={t('dock.trash')}
            title={t('dock.trashHint')}
            className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-surface-raised"
            onClick={() => {
              requestFilesTrash()
              launchApp('com.ageha.files')
            }}
          >
            {/* 半透明白瓷贴（参考图回收站位）。 */}
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-[24%] bg-gradient-to-br from-[#f2f6ff]/85 to-[#c7d6f5]/85 shadow-[0_1px_2px_rgba(15,23,42,0.25)] ring-1 ring-inset ring-white/50"
            >
              <Trash size={20} weight="fill" color="#5a6b82" />
            </span>
          </button>
        </div>
      </footer>
    </>
  )
}
