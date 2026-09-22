import { create } from 'zustand'

import { systemAuthService } from '@/core/auth'
import type { AuthError, User } from '@/core/auth'

export type SessionStatus = 'authenticated' | 'anonymous'

export interface LoginResult {
  ok: boolean
  error?: AuthError
}

interface SessionState {
  user: User | null
  status: SessionStatus
  /** True when boot cleared an expired session; shown once on the login screen. */
  sessionExpired: boolean
  login: (username: string, password: string) => Promise<LoginResult>
  register: (username: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  clearExpiredNotice: () => void
}

function initialUser(): { user: User | null; sessionExpired: boolean } {
  const hadSession =
    typeof localStorage !== 'undefined' && localStorage.getItem('agehaos.session.v1') !== null
  const user = systemAuthService.getUser()
  return {
    user,
    // A leftover session key that no longer verifies means it expired.
    sessionExpired: hadSession && user === null,
  }
}

const initial = initialUser()

export const useSessionStore = create<SessionState>()(() => ({
  user: initial.user,
  status: initial.user ? 'authenticated' : 'anonymous',
  sessionExpired: initial.sessionExpired,

  login: async (username, password) => {
    try {
      const { user } = await systemAuthService.login(username, password)
      useSessionStore.setState({ user, status: 'authenticated', sessionExpired: false })
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause as AuthError }
    }
  },

  register: async (username, password) => {
    try {
      const user = await systemAuthService.register(username, password)
      // Auto sign-in right after registration (PRD §4.1 flow).
      await useSessionStore.getState().login(user.username, password)
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: cause as AuthError }
    }
  },

  logout: async () => {
    systemAuthService.logout()
    useSessionStore.setState({ user: null, status: 'anonymous' })
  },

  clearExpiredNotice: () => useSessionStore.setState({ sessionExpired: false }),
}))

/** Restores boot defaults (signed out); used between tests. */
export function resetSessionStore(): void {
  useSessionStore.setState({ user: null, status: 'anonymous', sessionExpired: false })
}

/** Seeds an authenticated user without touching real credentials; tests only. */
export function seedSessionForTests(user: User): void {
  useSessionStore.setState({ user, status: 'authenticated', sessionExpired: false })
}
