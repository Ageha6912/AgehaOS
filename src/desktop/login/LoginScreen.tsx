import { useState, type FormEvent } from 'react'

import { BrandLogo } from '@/components/brand-logo'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import type { AuthErrorCode } from '@/core/auth'
import { useSessionStore } from '@/store/session-store'

const AUTH_ERROR_KEYS: Record<AuthErrorCode, MessageKey> = {
  'invalid-credentials': 'auth.error.invalidCredentials',
  'user-exists': 'auth.error.userExists',
  'invalid-username': 'auth.error.invalidUsername',
  'weak-password': 'auth.error.weakPassword',
  'not-authenticated': 'auth.error.generic',
}

export interface LoginScreenProps {
  /** Called after a successful sign-in / registration. */
  onSuccess: () => void
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const sessionExpired = useSessionStore((state) => state.sessionExpired)
  const clearExpiredNotice = useSessionStore((state) => state.clearExpiredNotice)
  const login = useSessionStore((state) => state.login)
  const register = useSessionStore((state) => state.register)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    const result =
      mode === 'login'
        ? await login(username.trim(), password)
        : await register(username.trim(), password)
    setBusy(false)
    if (result.ok) {
      onSuccess()
      return
    }
    setErrorKey(AUTH_ERROR_KEYS[result.error?.code ?? 'not-authenticated'])
  }

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setErrorKey(null)
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden surface-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_srgb,var(--ag-primary)_10%,transparent),transparent)]"
      />
      <div className="relative flex flex-col items-center gap-1">
        <div className="select-none" aria-hidden="true">
          <BrandLogo size={56} />
        </div>
        <h1 className="text-2xl font-semibold tracking-wide text-text">AgehaOS</h1>
        <p className="text-xs text-text-muted">{t('boot.login')}</p>
      </div>

      <form
        aria-label={mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
        className="surface-glass animate-os-pop-in relative w-full max-w-xs rounded-lg border border-border p-4 shadow-window"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="text-base font-semibold text-text">
          {mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
        </h2>

        {sessionExpired && (
          <p role="status" className="mt-2 rounded-md bg-primary/10 px-2 py-1.5 text-xs text-text">
            {t('auth.sessionExpired')}
          </p>
        )}

        <label className="mt-3 block text-xs text-text-muted">
          {t('auth.username')}
          <input
            required
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text transition-colors focus:border-primary"
          />
        </label>
        <label className="mt-2 block text-xs text-text-muted">
          {t('auth.password')}
          <input
            required
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text transition-colors focus:border-primary"
          />
        </label>

        {errorKey && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {t(errorKey)}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === 'login' ? t('auth.login') : t('auth.register')}
        </button>
        <button
          type="button"
          className="mt-2 w-full text-center text-xs text-text-muted hover:text-text"
          onClick={() => {
            clearExpiredNotice()
            switchMode(mode === 'login' ? 'register' : 'login')
          }}
        >
          {mode === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
        </button>
      </form>
    </div>
  )
}
