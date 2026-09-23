import { createHash, randomBytes } from 'node:crypto'

/** 256-bit opaque session token, URL-safe. The cookie value only. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function generateUserId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Public identifier for a session (device management): a short hash of the
 * token — safe to expose to the owning user without revealing the token.
 */
export function sessionIdOf(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16)
}
