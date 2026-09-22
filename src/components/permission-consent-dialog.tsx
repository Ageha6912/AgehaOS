import { useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { PERMISSION_LABEL_KEYS } from '@/core/permissions'
import type { Permission } from '@/core/permissions'

export interface PermissionConsentDialogProps {
  appName: string
  permissions: readonly Permission[]
  /** Receives the permissions the user kept checked. */
  onAllow: (granted: Permission[]) => void
  onDeny: () => void
}

/**
 * Install-time consent (PRD §10.2 Detect Permissions → User Consent).
 * The App Store flow (v0.2) mounts this before installApp + grant;
 * unchecked permissions stay denied (default deny, PRD §10.3).
 */
export function PermissionConsentDialog({
  appName,
  permissions,
  onAllow,
  onDeny,
}: PermissionConsentDialogProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<Permission>>(() => new Set(permissions))

  const toggle = (permission: Permission) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(permission)) next.delete(permission)
      else next.add(permission)
      return next
    })
  }

  return (
    <div
      role="dialog"
      aria-label={t('permission.dialog.title')}
      className="animate-os-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
    >
      <div className="surface-glass animate-os-pop-in w-full max-w-md rounded-lg border border-border p-5 shadow-window">
        <h2 className="text-base font-semibold text-text">{t('permission.dialog.title')}</h2>
        <p className="mt-1 text-sm text-text-muted">
          <span className="font-medium text-text">{appName}</span>
          {t('permission.dialog.body')}
        </p>

        <ul className="mt-4 space-y-2">
          {permissions.map((permission) => (
            <li key={permission}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-text hover:bg-surface-raised">
                <input
                  type="checkbox"
                  checked={selected.has(permission)}
                  onChange={() => toggle(permission)}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                {t(PERMISSION_LABEL_KEYS[permission])}
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
            onClick={onDeny}
          >
            {t('permission.dialog.deny')}
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onAllow([...selected])}
          >
            {t('permission.dialog.allow')}
          </button>
        </div>
      </div>
    </div>
  )
}
