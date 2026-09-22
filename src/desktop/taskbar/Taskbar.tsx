import { useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { useClock } from './use-clock'
import { UserMenu } from './UserMenu'

export function Taskbar() {
  const clock = useClock()
  const windows = useWindowStore((s) => s.windows)
  const focus = useWindowStore((s) => s.focus)
  const minimize = useWindowStore((s) => s.minimize)
  const restore = useWindowStore((s) => s.restore)

  const toggleWindow = (id: string, focused: boolean, minimized: boolean) => {
    if (minimized) restore(id)
    else if (focused) minimize(id)
    else focus(id)
  }

  return (
    <footer className="absolute inset-x-0 bottom-0 z-40 flex h-12 items-center gap-2 border-t border-border bg-surface/95 px-2 backdrop-blur">
      <AppLauncher />

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {windows.map((win) => (
          <button
            key={win.id}
            type="button"
            title={win.title}
            onClick={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
            className={`flex h-8 max-w-44 items-center rounded-md border px-3 text-sm ${
              win.focused && win.state !== 'minimized'
                ? 'border-primary/50 bg-surface-raised text-text'
                : 'border-transparent text-text-muted hover:bg-surface-raised'
            }`}
          >
            <span className="truncate">{win.title}</span>
          </button>
        ))}
      </div>

      <UserMenu />
      <time className="shrink-0 px-2 text-xs text-text-muted">{clock}</time>
    </footer>
  )
}
