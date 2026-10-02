import { useRef, useState } from 'react'

import { SignOut, User } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { useSessionStore } from '@/store/session-store'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'

export function UserMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menuPhase = useExitPhase(open)
  const user = useSessionStore((state) => state.user)
  const logout = useSessionStore((state) => state.logout)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  usePopoverDismiss(
    'user',
    open,
    (reason) => {
      const focusInside = wrapperRef.current?.contains(document.activeElement) ?? false
      setOpen(false)
      if (reason === 'escape' && focusInside) triggerRef.current?.focus()
    },
    { insideRefs: [wrapperRef] },
  )

  if (!user) return null

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-text hover:bg-surface-raised"
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
          className={`popover-panel surface-glass absolute top-10 right-0 z-50 w-40 p-1.5 ${popoverMotionClass(menuPhase.exiting)}`}
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
