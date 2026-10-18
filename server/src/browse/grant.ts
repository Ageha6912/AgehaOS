import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 子域浏览会话的 HMAC 授权令牌（档 ③）：主域（os.ageha.cn）为已登录用户
 * 签短期领取令牌 → 子域引导页用它换取子域自有 httpOnly cookie（browse
 * grant）→ 子域上的 /https、/raw 请求凭 grant 放行。主域会话 cookie 是
 * host-only，天然不跨子域外泄；grant 由子域 cookie 承载，页面 JS 读不到。
 *
 * 格式：`<base64url(JSON{u,exp})>.<base64url(hmacSha256(payload))>`；
 * 只承载 userId 与过期时间——不含任何敏感内容。
 */

export interface GrantPayload {
  u: string
  exp: number
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

function hmac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

export function signGrant(secret: string, userId: string, ttlMs: number, now: number): string {
  const payload = b64url(JSON.stringify({ u: userId, exp: now + ttlMs } satisfies GrantPayload))
  return `${payload}.${b64url(hmac(secret, payload))}`
}

/** 验签 + 过期检查：通过返回 userId，否则 null（绝不 throw）。 */
export function verifyGrant(secret: string, value: string, now: number): string | null {
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const payload = value.slice(0, dot)
  const signature = value.slice(dot + 1)
  let expected: Buffer
  try {
    expected = hmac(secret, payload)
  } catch {
    return null
  }
  let given: Buffer
  try {
    given = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GrantPayload
    if (typeof parsed.u !== 'string' || parsed.u === '') return null
    if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null
    return parsed.u
  } catch {
    return null
  }
}

/** 领取令牌 TTL（主域 UI 到子域引导之间的短窗口）。 */
export const CLAIM_TOKEN_TTL_MS = 10 * 60 * 1000
/** 子域 browse 会话 TTL（到期由浏览器应用重新引导续期）。 */
export const BROWSE_GRANT_TTL_MS = 6 * 60 * 60 * 1000
/** 子域 browse 会话 cookie 名（httpOnly，仅子域可见）。 */
export const BROWSE_COOKIE = 'agehaos_browse'
