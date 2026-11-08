import { useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { PERMISSION_LABEL_KEYS } from '@/core/permissions'
import type { Permission } from '@/core/permissions'

import { DialogShell } from './dialog-shell'

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
 *
 * 弹层壳归 DialogShell（portal 到 body + aria-modal + 焦点陷阱 + Esc/遮罩
 * 取消，E3 审查修复）；初始焦点落在首个权限复选框（无权限时落拒绝键），
 * 键盘用户不必再从被遮罩的商店列表 Tab 进来。
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
    <DialogShell title={t('permission.dialog.title')} testId="permission-consent-dialog" onClose={onDeny}>
      <div className="surface-glass animate-os-pop-in w-full max-w-md rounded-lg border border-border p-5 shadow-window">
        <h2 className="text-base font-semibold text-text">{t('permission.dialog.title')}</h2>
        <p className="mt-1 text-sm text-text-muted">
          <span className="font-medium text-text">{appName}</span>
          {t('permission.dialog.body')}
        </p>

        <ul className="mt-4 space-y-2">
          {permissions.map((permission, index) => (
            <li key={permission}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-text hover:bg-surface-raised">
                <input
                  type="checkbox"
                  data-autofocus={index === 0 ? true : undefined}
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
            data-autofocus={permissions.length === 0 ? true : undefined}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
            onClick={onDeny}
          >
            {t('permission.dialog.deny')}
          </button>
          <button
            type="button"
            disabled={permissions.length > 0 && selected.size === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onAllow([...selected])}
          >
            {t('permission.dialog.allow')}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
