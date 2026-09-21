import { useState } from 'react'

import { BUILTIN_APPS, type RegisteredApp } from '@/apps/registry'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

export function AppLauncher() {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const openWindow = useWindowStore((s) => s.open)

  const launch = (app: RegisteredApp) => {
    openWindow({
      appId: app.appId,
      title: t(app.titleKey),
      width: app.width,
      height: app.height,
    })
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-text hover:bg-surface-raised"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">🦋</span>
        {t('taskbar.start')}
      </button>

      {open && (
        <menu
          aria-label={t('taskbar.start')}
          className="absolute bottom-10 left-0 z-50 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-window"
        >
          {BUILTIN_APPS.map((app) => (
            <li key={app.appId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
                onClick={() => launch(app)}
              >
                <span aria-hidden="true" className="text-lg">
                  {app.icon}
                </span>
                {t(app.titleKey)}
              </button>
            </li>
          ))}
        </menu>
      )}
    </div>
  )
}
