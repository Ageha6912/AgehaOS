export interface User {
  id: string
  username: string
  /** Optional profile fields (PRD §12.1 修改昵称/头像). */
  displayName?: string
  email?: string
  /** Client-resized avatar data URL (png/jpeg/webp, ≤64KB chars). */
  avatar?: string
  createdAt: string
  updatedAt: string
}

export interface Session {
  token: string
  userId: string
  expiresAt: number
}

export interface StoredUser extends User {
  passwordSalt: string
  passwordHash: string
}

export type AuthErrorCode =
  'user-exists' | 'invalid-credentials' | 'invalid-username' | 'weak-password' | 'not-authenticated'

/** Profile patch input: absent = unchanged, explicit null = clear. */
export interface ProfileInput {
  displayName?: string | null
  email?: string | null
  avatar?: string | null
}

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthResult {
  user: User
  session: Session
}
