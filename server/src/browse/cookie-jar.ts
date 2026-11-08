/**
 * 浏览器代理的服务端 Cookie 罐（2026-10-18 档 ②）：上游 Set-Cookie 落罐、
 * 后续请求按目标源带回——窗口内解锁登录态（POST 转发 + 罐 = 登录闭环）。
 *
 * 安全纪律：cookie 值只存在于服务端（按用户隔离的 DataStore blob），**永不
 * 回传浏览器、永不进日志**；单值/单源/总量三级封顶，过期条目按需剪除。
 *
 * 语义简化（v1）：不解释 Domain/Path/Secure/SameSite 属性——罐按「最终 URL
 * 的 origin」分桶、整源回放。典型站点的会话 cookie 都落在本站 origin 上；
 * 跨子域 SSO（父域 cookie）属已知边界，可能不完整。
 */

export interface JarCookie {
  name: string
  value: string
  /** 绝对过期时间（ms）；null = 会话内存活（用户罐生命周期内有效）。 */
  expiresAt: number | null
}

export interface CookieJar {
  /** origin（scheme://host[:port]）→ 条目（同名去重，保持插入序）。 */
  origins: Record<string, JarCookie[]>
}

/** 每用户罐总量上限（序列化字节）。 */
export const JAR_MAX_TOTAL_BYTES = 64 * 1024
/** 单源条目上限（超限丢最旧）。 */
export const JAR_MAX_PER_ORIGIN = 40
/** 单值字符上限（超限整条不收）。 */
export const JAR_MAX_VALUE_CHARS = 4096

export function emptyJar(): CookieJar {
  return { origins: {} }
}

/** 防坏数据解析：任何畸形结构兜底为空罐（绝不 throw）。 */
export function parseJar(raw: string | null): CookieJar {
  if (raw === null) return emptyJar()
  try {
    const parsed = JSON.parse(raw) as { origins?: unknown }
    const origins = parsed?.origins
    if (typeof origins !== 'object' || origins === null) return emptyJar()
    const out = emptyJar()
    for (const [origin, list] of Object.entries(origins as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const cookies: JarCookie[] = []
      for (const item of list) {
        const entry = item as Partial<JarCookie> | null
        if (typeof entry?.name !== 'string' || typeof entry?.value !== 'string') continue
        if (entry.name === '' || entry.value.length > JAR_MAX_VALUE_CHARS) continue
        cookies.push({
          name: entry.name,
          value: entry.value,
          expiresAt: typeof entry.expiresAt === 'number' ? entry.expiresAt : null,
        })
      }
      if (cookies.length > 0) out.origins[origin] = cookies
    }
    return out
  } catch {
    return emptyJar()
  }
}

export function serializeJar(jar: CookieJar): string {
  return JSON.stringify({ origins: jar.origins })
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export interface ParsedSetCookie {
  name: string
  value: string
  expiresAt: number | null
  /** 删除标记（Max-Age<=0 或 Expires 已过）：从罐中剔除同名条目。 */
  remove: boolean
}

const INVALID_NAME = /[\s;,=]/

/** 值中不允许的字符（行分隔/空字节——头部注入面）。 */
function hasInvalidValueChars(value: string): boolean {
  return value.includes('\r') || value.includes('\n') || value.includes('\u0000')
}

/** 单条 Set-Cookie 解析：首个 `;` 前是 name=value；Max-Age 优先于 Expires。
 *  畸形（缺 name/非法字符/超长值）返回 null——整条不收。 */
export function parseSetCookie(header: string, now: number): ParsedSetCookie | null {
  const segments = header.split(';')
  const first = segments[0] ?? ''
  const eq = first.indexOf('=')
  if (eq <= 0) return null
  const name = first.slice(0, eq).trim()
  const value = first.slice(eq + 1).trim()
  if (name === '' || INVALID_NAME.test(name)) return null
  if (hasInvalidValueChars(value) || value.length > JAR_MAX_VALUE_CHARS) return null

  // RFC 6265 §5.3：Max-Age 在则优先（与 Expires 出现顺序无关），Max-Age
  // 非法/缺席才看 Expires——先收集两个属性再统一裁决，避免增量赋值把先出现
  // 的 Expires=过去 误判成 remove（A2 审查轻微项）。
  let maxAgeSeconds: number | null = null
  let expiresTime: number | null = null
  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf('=')
    const key = (eqIndex >= 0 ? segment.slice(0, eqIndex) : segment).trim().toLowerCase()
    const attrValue = (eqIndex >= 0 ? segment.slice(eqIndex + 1) : '').trim()
    if (key === 'max-age') {
      const seconds = Number.parseInt(attrValue, 10)
      if (!Number.isNaN(seconds)) maxAgeSeconds = seconds
    } else if (key === 'expires') {
      const time = Date.parse(attrValue)
      if (!Number.isNaN(time)) expiresTime = time
    }
  }
  let expiresAt: number | null = null
  let remove = false
  if (maxAgeSeconds !== null) {
    if (maxAgeSeconds <= 0) remove = true
    else expiresAt = now + maxAgeSeconds * 1000
  } else if (expiresTime !== null) {
    if (expiresTime <= now) remove = true
    else expiresAt = expiresTime
  }
  return { name, value, expiresAt, remove }
}

/** 剪除过期条目与空源。 */
export function pruneJar(jar: CookieJar, now: number): CookieJar {
  const origins: Record<string, JarCookie[]> = {}
  for (const [origin, cookies] of Object.entries(jar.origins)) {
    const alive = cookies.filter((cookie) => cookie.expiresAt === null || cookie.expiresAt > now)
    if (alive.length > 0) origins[origin] = alive
  }
  return { origins }
}

/** 把一组 Set-Cookie 合并进罐（新增/覆盖/删除 + 单源上限裁剪 + 过期剪除）。 */
export function mergeSetCookies(
  jar: CookieJar,
  origin: string,
  setCookies: readonly string[],
  now: number,
): CookieJar {
  if (setCookies.length === 0) return jar
  let next = [...(jar.origins[origin] ?? [])]
  for (const header of setCookies) {
    const parsed = parseSetCookie(header, now)
    if (parsed === null) continue
    const index = next.findIndex((cookie) => cookie.name === parsed.name)
    if (parsed.remove) {
      if (index >= 0) next.splice(index, 1)
      continue
    }
    const entry: JarCookie = { name: parsed.name, value: parsed.value, expiresAt: parsed.expiresAt }
    if (index >= 0) next[index] = entry
    else next.push(entry)
  }
  if (next.length > JAR_MAX_PER_ORIGIN) next = next.slice(next.length - JAR_MAX_PER_ORIGIN)
  const origins = { ...jar.origins }
  if (next.length === 0) delete origins[origin]
  else origins[origin] = next
  return pruneJar({ origins }, now)
}

/** 生成某源上行 Cookie 头值（过滤过期）；无可用条目返回 null。 */
export function cookiesForOrigin(jar: CookieJar, origin: string, now: number): string | null {
  const cookies = (jar.origins[origin] ?? []).filter(
    (cookie) => cookie.expiresAt === null || cookie.expiresAt > now,
  )
  if (cookies.length === 0) return null
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

/** 总量封顶（防御性兜底）：按 origin 插入序保留装得下的前缀，装不下的整源丢弃。 */
export function capJarBytes(jar: CookieJar, maxBytes = JAR_MAX_TOTAL_BYTES): CookieJar {
  if (serializeJar(jar).length <= maxBytes) return jar
  const origins: Record<string, JarCookie[]> = {}
  for (const [origin, cookies] of Object.entries(jar.origins)) {
    origins[origin] = cookies
    if (serializeJar({ origins }).length > maxBytes) {
      delete origins[origin]
      break
    }
  }
  return { origins }
}
