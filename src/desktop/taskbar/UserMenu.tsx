import { useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { useSessionStore } from '@/store/session-store'

export function UserMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const user = useSessionStore((state) => state.user)
  const logout = useSessionStore((state) => state.logout)

  if (!user) return null

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-text hover:bg-surface-raised"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">👤</span>
        {user.username}
      </button>
      {open && (
        <menu
          aria-label={user.username}
          className="absolute bottom-10 right-0 z-50 w-40 rounded-lg border border-border bg-surface p-1.5 shadow-window"
        >
          <li>
            <button
              type="button"
              className="w-full rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
              onClick={() => {
                setOpen(false)
                void logout()
              }}
            >
              {t('auth.logout')}
            </button>
          </li>
        </menu>
      )}
    </div>
  )
}
