import { randomBytes } from 'node:crypto'

/** 256-bit opaque session token, URL-safe. The cookie value only. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function generateUserId(): string {
  return randomBytes(16).toString('hex')
}
