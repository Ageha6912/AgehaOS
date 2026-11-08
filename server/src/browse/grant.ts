import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 子域浏览会话的 HMAC 授权令牌（档 ③）：主域（os.ageha.cn）为已登录用户
 * 签短期领取令牌 → 子域引导页用它换取子域自有 httpOnly cookie（browse
 * grant）→ 子域上的 /https、/raw 请求凭 grant 放行。主域会话 cookie 是
 * host-only，天然不跨子域外泄；grant 由子域 cookie 承载，页面 JS 读不到。
 *
 * 格式：`<base64url(JSON{u,exp,s})>.<base64url(hmacSha256(payload))>`；
 * 只承载 userId、过期时间与用途域——不含任何敏感内容。
 */

export interface GrantPayload {
  u: string
  exp: number
  /** 用途域（A2 审查轻微项）：claim 与 browse 两种令牌互不通用。 */
  s: GrantScope
}

/** claim = 主域签发的短窗口领取令牌；browse = 子域 6h 会话。 */
export type GrantScope = 'claim' | 'browse'

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

function hmac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

export function signGrant(
  secret: string,
  userId: string,
  ttlMs: number,
  now: number,
  scope: GrantScope,
): string {
  const payload = b64url(
    JSON.stringify({ u: userId, exp: now + ttlMs, s: scope } satisfies GrantPayload),
  )
  return `${payload}.${b64url(hmac(secret, payload))}`
}

/** 验签 + 过期检查 + 用途域匹配：通过返回 userId，否则 null（绝不 throw）。 */
export function verifyGrant(
  secret: string,
  value: string,
  now: number,
  expectedScope: GrantScope,
): string | null {
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
    // 旧版载荷（无 s 字段）与跨用途域令牌一并拒绝——browse grant 不能当
    // claim token 再换 6h（削弱防续期），claim token 也不能当 browse cookie。
    if (parsed.s !== expectedScope) return null
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
