import { useState } from 'react'

import { SignOut, User } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { useSessionStore } from '@/store/session-store'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'

export function UserMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menuPhase = useExitPhase(open)
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
        {user.avatar ? (
          <img
            src={user.avatar}
            alt=""
            data-testid="user-avatar"
            className="h-5 w-5 rounded-full object-cover"
          />
        ) : (
          <User size={14} weight="regular" />
        )}
        {user.displayName ?? user.username}
      </button>
      {menuPhase.render && (
        <menu
          aria-label={user.username}
          className={`surface-glass absolute bottom-10 right-0 z-50 w-40 rounded-lg border border-border p-1.5 shadow-window ${popoverMotionClass(menuPhase.exiting)}`}
        >
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
              onClick={() => {
                setOpen(false)
                void logout()
              }}
            >
              <SignOut size={14} weight="regular" />
              {t('auth.logout')}
            </button>
          </li>
        </menu>
      )}
    </div>
  )
}
