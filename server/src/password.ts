import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

interface ScryptOptions {
  N: number
  r: number
  p: number
  maxmem: number
}

/** OWASP-recommended scrypt baseline (2023+): N=2^15, r=8, p=1. */
const SCRYPT_N = 2 ** 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
/** 128·N·r is exactly 32 MiB — Node's default maxmem rejects it, so allow more. */
const MAXMEM = 64 * 1024 * 1024

/**
 * Stored format: `scrypt$N$r$p$<salt b64>$<hash b64>`. Parameters travel with
 * the hash so the cost can be raised later without invalidating old users.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts
  const N = Number.parseInt(nRaw ?? '', 10)
  const r = Number.parseInt(rRaw ?? '', 10)
  const p = Number.parseInt(pRaw ?? '', 10)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  const salt = Buffer.from(saltB64 ?? '', 'base64')
  const expected = Buffer.from(hashB64 ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false
  try {
    const derived = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAXMEM })
    return timingSafeEqual(derived, expected)
  } catch {
    /* cost parameters out of range for this machine's memory limit */
    return false
  }
}
