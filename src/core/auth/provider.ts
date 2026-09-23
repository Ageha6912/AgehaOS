import { AuthService } from './auth-service'
import type { AuthResult, ProfileInput, Session, SessionInfo, User } from './types'

export type { ProfileInput, SessionInfo } from './types'
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
  /** Patch profile fields; absent = unchanged, explicit null = clear. */
  updateProfile(input: ProfileInput): Promise<User>
  /** Verifies the current password, then re-hashes and revokes other sessions. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  /** Signs out every other session of this account; returns revoked count. */
  revokeOtherSessions(): Promise<number>
  /** Lists live sessions of this account (device management, PRD §35). */
  listSessions(): Promise<SessionInfo[]>
  /** Revokes one session by its public id (the current one signs itself out). */
  revokeSession(id: string): Promise<void>
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
  updateProfile: (input) => activeProvider.updateProfile(input),
  changePassword: (current, next) => activeProvider.changePassword(current, next),
  revokeOtherSessions: () => activeProvider.revokeOtherSessions(),
  listSessions: () => activeProvider.listSessions(),
  revokeSession: (id) => activeProvider.revokeSession(id),
}

/** Installs an alternative provider; `null` restores the local one (tests). */
export function setAuthProvider(provider: AuthProvider | null): void {
  activeProvider = provider ?? localAuthService
}

export function getAuthProvider(): AuthProvider {
  return activeProvider
}

/** True when main.tsx installed the remote (backend) provider at boot. */
export function isRemoteAuthActive(): boolean {
  return activeProvider !== localAuthService
}
