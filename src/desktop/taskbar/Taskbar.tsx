import { useRef, useState } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { NotificationCenter } from './NotificationCenter'
import { useClock } from './use-clock'
import { UserMenu } from './UserMenu'
import { WindowPreview } from './WindowPreview'

const HOVER_DELAY_MS = 350

export function Taskbar() {
  const clock = useClock()
  const windows = useWindowStore((s) => s.windows)
  const focus = useWindowStore((s) => s.focus)
  const minimize = useWindowStore((s) => s.minimize)
  const restore = useWindowStore((s) => s.restore)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [anchorLeft, setAnchorLeft] = useState(0)
  const hoverTimer = useRef<number | null>(null)

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
    <footer className="surface-glass absolute inset-x-0 bottom-0 z-40 flex h-12 items-center gap-2 border-t border-border px-2">
      <AppLauncher />

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
                <AppIcon appId={win.appId} size={20} />
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

      <NotificationCenter />
      <UserMenu />
      <time className="shrink-0 px-2 text-xs text-text-muted">{clock}</time>
    </footer>
  )
}
