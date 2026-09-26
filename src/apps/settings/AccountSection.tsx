import { useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { AvatarError, fileToAvatarDataUrl } from '@/core/auth/avatar'
import { AuthError, isRemoteAuthActive, systemAuthService } from '@/core/auth'
import type { SessionInfo } from '@/core/auth'
import { useSessionStore } from '@/store/session-store'
import { isSyncEnabled, setSyncEnabled } from '@/services/settings-sync'
import { ToggleSwitch } from '@/components/toggle-switch'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function actionErrorKey(error: AuthError | AvatarError | undefined): MessageKey {
  if (error instanceof AvatarError) {
    return error.code === 'avatar-too-large'
      ? 'settings.account.avatarTooLarge'
      : 'settings.account.avatarInvalid'
  }
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [syncOn, setSyncOn] = useState(isSyncEnabled())

  useEffect(() => {
    if (!isRemoteAuthActive()) return
    const timer = window.setTimeout(() => {
      void systemAuthService
        .listSessions()
        .then((rows) => setSessions(rows))
        .catch(() => setSessions([]))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  if (!user) return null

  const applyAvatar = async (dataUrl: string | null): Promise<void> => {
    setProfileNotice(null)
    const result = await updateProfile({ avatar: dataUrl })
    if (!result.ok) setProfileNotice(actionErrorKey(result.error))
  }

  const onAvatarFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setProfileNotice(null)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      await applyAvatar(dataUrl)
    } catch (cause) {
      setProfileNotice(actionErrorKey(cause instanceof AvatarError ? cause : undefined))
    }
  }

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
        <div className="flex items-center gap-4">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={t('settings.account.avatar')}
              data-testid="account-avatar-preview"
              className="h-16 w-16 rounded-full border border-border object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              data-testid="account-avatar-preview"
              className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-surface-raised text-2xl text-text-muted"
            >
              {user.username.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="space-x-2">
            <button
              type="button"
              data-testid="avatar-change"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
              onClick={() => fileInputRef.current?.click()}
            >
              {t('settings.account.avatarChange')}
            </button>
            {user.avatar && (
              <button
                type="button"
                data-testid="avatar-remove"
                className="rounded-md px-3 py-1.5 text-xs text-text-muted hover:bg-surface-raised hover:text-text"
                onClick={() => void applyAvatar(null)}
              >
                {t('settings.account.avatarRemove')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                void onAvatarFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        </div>
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
        <h3 className="mb-3 text-sm font-semibold text-text">{t('settings.account.securityTitle')}</h3>

        {isRemoteAuthActive() && sessions.length > 0 && (
          <ul className="mb-3 space-y-1.5" data-testid="session-list">
            {sessions.map((session) => (
              <li
                key={session.id}
                data-testid="session-row"
                className="flex items-center justify-between rounded-md border border-border bg-surface-raised/50 px-2.5 py-2 text-xs"
              >
                <span className="min-w-0">
                  <span className="block text-text">{session.device}</span>
                  {session.createdAt && (
                    <span className="block text-[10px] text-text-muted">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </span>
                {session.current ? (
                  <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] text-text">
                    {t('settings.account.sessionCurrent')}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="session-revoke"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] text-text-muted hover:bg-surface-raised hover:text-text"
                    onClick={() => {
                      void systemAuthService
                        .revokeSession(session.id)
                        .then(() => setSessions((prev) => prev.filter((row) => row.id !== session.id)))
                        .catch(() => setRevokeNotice('auth.error.generic'))
                    }}
                  >
                    {t('settings.account.sessionRevoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

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

        {isRemoteAuthActive() && (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="mb-1 text-sm font-semibold text-text">{t('settings.account.sync')}</h3>
            <p className="mb-2 text-xs text-text-muted">{t('settings.account.syncHint')}</p>
            <div className="flex items-center gap-2">
              <ToggleSwitch
                checked={syncOn}
                label={t('settings.account.syncToggle')}
                testId="settings-sync-toggle"
                onClick={() => {
                  setSyncEnabled(!syncOn)
                  setSyncOn(!syncOn)
                }}
              />
              <span className="text-xs text-text">{t('settings.account.syncToggle')}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
