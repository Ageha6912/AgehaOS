const HEX = 16

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(HEX).padStart(2, '0')).join('')
}

export function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return toHex(bytes)
}

/** SHA-256 over `salt:password`; local v0.1 stand-in for a server-side hash (PRD §21.1). */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(digest))
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashPassword(password, salt)
  // Constant-time-ish comparison to avoid trivial short-circuits.
  if (actual.length !== expectedHash.length) return false
  let mismatch = 0
  for (let i = 0; i < actual.length; i++) {
    mismatch |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i)
  }
  return mismatch === 0
}
