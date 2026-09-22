import { useState } from 'react'

import { Package } from '@phosphor-icons/react'

import { componentFor } from '@/apps/builtin'
import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useAppStore } from '@/store/app-store'

export function AppLauncher() {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)

  const launch = (appId: string) => {
    launchApp(appId)
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
          className="surface-glass animate-os-pop-in absolute bottom-10 left-0 z-50 w-56 rounded-lg border border-border p-1.5 shadow-window"
        >
          {apps.map((app) => {
            const meta = componentFor(app.id)
            return (
              <li key={app.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
                  onClick={() => launch(app.id)}
                >
                  <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center text-base">
                    {meta?.icon ?? <Package size={16} weight="regular" />}
                  </span>
                  {meta ? t(meta.titleKey) : app.name}
                </button>
              </li>
            )
          })}
        </menu>
      )}
    </div>
  )
}
