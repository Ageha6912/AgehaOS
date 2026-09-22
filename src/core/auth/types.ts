export interface User {
  id: string
  username: string
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
