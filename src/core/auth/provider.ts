import { AuthService } from './auth-service'
import type { AuthResult, Session, User } from './types'

/**
 * Storage + transport contract for the auth system. Two implementations:
 * the local AuthService (localStorage, v0.1 default) and RemoteAuthClient
 * (Milestone 5 backend, HttpOnly cookie sessions — PRD §30.4).
 */
export interface AuthProvider {
  register(username: string, password: string): Promise<User>
  login(username: string, password: string): Promise<AuthResult>
  logout(): string | null
  getSession(): Session | null
  getUser(): User | null
  /** Boot-time re-check against the source of truth; null means signed out. */
  reconcile(): Promise<User | null>
}

const localAuthService = new AuthService()

let activeProvider: AuthProvider = localAuthService

/**
 * Process-level auth facade. UI and stores import this singleton only;
 * main.tsx swaps the backing provider at boot based on configuration, so
 * switching local/remote never touches call sites.
 */
export const systemAuthService: AuthProvider = {
  register: (username, password) => activeProvider.register(username, password),
  login: (username, password) => activeProvider.login(username, password),
  logout: () => activeProvider.logout(),
  getSession: () => activeProvider.getSession(),
  getUser: () => activeProvider.getUser(),
  reconcile: () => activeProvider.reconcile(),
}

/** Installs an alternative provider; `null` restores the local one (tests). */
export function setAuthProvider(provider: AuthProvider | null): void {
  activeProvider = provider ?? localAuthService
}

export function getAuthProvider(): AuthProvider {
  return activeProvider
}
