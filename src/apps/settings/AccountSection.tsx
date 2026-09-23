import { useState } from 'react'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { AuthError } from '@/core/auth'
import { useSessionStore } from '@/store/session-store'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function actionErrorKey(error: AuthError | undefined): MessageKey {
  switch (error?.code) {
    case 'invalid-credentials':
      return 'settings.account.wrongPassword'
    case 'weak-password':
      return 'auth.error.weakPassword'
    default:
      return 'auth.error.generic'
  }
}

export function AccountSection() {
  const { t } = useTranslation()
  const user = useSessionStore((s) => s.user)
  const updateProfile = useSessionStore((s) => s.updateProfile)
  const changePassword = useSessionStore((s) => s.changePassword)
  const revokeOtherSessions = useSessionStore((s) => s.revokeOtherSessions)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [profileNotice, setProfileNotice] = useState<MessageKey | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordNotice, setPasswordNotice] = useState<MessageKey | null>(null)

  const [revokeNotice, setRevokeNotice] = useState<MessageKey | null>(null)

  if (!user) return null

  const saveProfile = async (): Promise<void> => {
    setProfileNotice(null)
    if (email !== '' && !EMAIL_PATTERN.test(email)) {
      setProfileNotice('settings.account.emailInvalid')
      return
    }
    const result = await updateProfile({
      displayName: displayName.trim() === '' ? null : displayName.trim(),
      email: email.trim() === '' ? null : email.trim(),
    })
    setProfileNotice(result.ok ? 'settings.account.saved' : actionErrorKey(result.error))
  }

  const submitPassword = async (): Promise<void> => {
    setPasswordNotice(null)
    if (newPassword.length < 6) {
      setPasswordNotice('auth.error.weakPassword')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordNotice('settings.account.passwordMismatch')
      return
    }
    const result = await changePassword(currentPassword, newPassword)
    if (result.ok) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordNotice('settings.account.passwordChanged')
    } else {
      setPasswordNotice(actionErrorKey(result.error))
    }
  }

  const revokeOthers = async (): Promise<void> => {
    setRevokeNotice(null)
    const result = await revokeOtherSessions()
    setRevokeNotice(result.ok ? 'settings.account.revokeDone' : actionErrorKey(result.error))
  }

  const fieldClass =
    'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text focus-visible:outline-primary'

  return (
    <section aria-label={t('settings.account')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('settings.account')}</h2>

      <div className="mb-6 max-w-md space-y-3">
        <div>
          <label htmlFor="account-username" className="mb-1 block text-xs text-text-muted">
            {t('settings.account.username')}
          </label>
          <input
            id="account-username"
            value={user.username}
            readOnly
            className={`${fieldClass} opacity-60`}
          />
        </div>
        <div>
          <label htmlFor="account-display-name" className="mb-1 block text-xs text-text-muted">
            {t('settings.account.displayName')}
          </label>
          <input
            id="account-display-name"
            value={displayName}
            maxLength={32}
            onChange={(event) => setDisplayName(event.target.value)}
            className={fieldClass}
          />
          <p className="mt-1 text-xs text-text-muted">{t('settings.account.displayNameHint')}</p>
        </div>
        <div>
          <label htmlFor="account-email" className="mb-1 block text-xs text-text-muted">
            {t('settings.account.email')}
          </label>
          <input
            id="account-email"
            type="email"
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-contrast hover:opacity-90"
            onClick={() => void saveProfile()}
          >
            {t('settings.account.save')}
          </button>
          {profileNotice && (
            <p role="status" className="text-xs text-text-muted">
              {t(profileNotice)}
            </p>
          )}
        </div>
      </div>

      <div className="mb-6 max-w-md border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-semibold text-text">{t('settings.account.passwordTitle')}</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor="account-current-password" className="mb-1 block text-xs text-text-muted">
              {t('settings.account.currentPassword')}
            </label>
            <input
              id="account-current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="account-new-password" className="mb-1 block text-xs text-text-muted">
              {t('settings.account.newPassword')}
            </label>
            <input
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="account-confirm-password" className="mb-1 block text-xs text-text-muted">
              {t('settings.account.confirmPassword')}
            </label>
            <input
              id="account-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-contrast hover:opacity-90"
              onClick={() => void submitPassword()}
            >
              {t('settings.account.updatePassword')}
            </button>
            {passwordNotice && (
              <p role="status" className="text-xs text-text-muted">
                {t(passwordNotice)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-md border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-semibold text-text">{t('settings.account.securityTitle')}</h3>
        <p className="mb-3 text-xs text-text-muted">{t('settings.account.revokeOthersHint')}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
            onClick={() => void revokeOthers()}
          >
            {t('settings.account.revokeOthers')}
          </button>
          {revokeNotice && (
            <p role="status" className="text-xs text-text-muted">
              {t(revokeNotice)}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
