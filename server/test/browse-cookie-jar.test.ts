import { describe, expect, it } from 'vitest'

import {
  capJarBytes,
  cookiesForOrigin,
  emptyJar,
  JAR_MAX_PER_ORIGIN,
  mergeSetCookies,
  originOf,
  parseJar,
  parseSetCookie,
  pruneJar,
  serializeJar,
  type CookieJar,
} from '../src/browse/cookie-jar'

const NOW = 1_700_000_000_000
const ORIGIN = 'https://example.com'

describe('parseSetCookie（Set-Cookie 解析）', () => {
  it('name=value 与属性拆分；值里的 = 保留', () => {
    expect(parseSetCookie('sid=abc=def; Path=/; HttpOnly', NOW)).toEqual({
      name: 'sid',
      value: 'abc=def',
      expiresAt: null,
      remove: false,
    })
  })

  it('Max-Age 优先于 Expires；任何顺序一致', () => {
    const withBoth = parseSetCookie(
      `s=1; Expires=${new Date(NOW + 60_000).toUTCString()}; Max-Age=120`,
      NOW,
    )
    expect(withBoth?.expiresAt).toBe(NOW + 120_000)
    const reversed = parseSetCookie(
      `s=1; Max-Age=120; Expires=${new Date(NOW + 60_000).toUTCString()}`,
      NOW,
    )
    expect(reversed?.expiresAt).toBe(NOW + 120_000)
  })

  it('删除标记：Max-Age<=0 与已过 Expires', () => {
    expect(parseSetCookie('s=; Max-Age=0', NOW)?.remove).toBe(true)
    expect(parseSetCookie('s=; Max-Age=-1', NOW)?.remove).toBe(true)
    expect(parseSetCookie(`s=; Expires=${new Date(NOW - 1000).toUTCString()}`, NOW)?.remove).toBe(
      true,
    )
  })

  it('畸形整条拒收：缺 name、非法字符、超长值', () => {
    expect(parseSetCookie('=abc', NOW)).toBeNull()
    expect(parseSetCookie('bad name=1', NOW)).toBeNull()
    expect(parseSetCookie('s=a\r\nb', NOW)).toBeNull()
    expect(parseSetCookie(`s=${'x'.repeat(5000)}`, NOW)).toBeNull()
  })
})

describe('mergeSetCookies / cookiesForOrigin（罐合并与回放）', () => {
  it('新增/覆盖/删除 + 格式回放（分号空格连接）', () => {
    let jar = mergeSetCookies(emptyJar(), ORIGIN, ['a=1', 'b=2'], NOW)
    expect(cookiesForOrigin(jar, ORIGIN, NOW)).toBe('a=1; b=2')

    jar = mergeSetCookies(jar, ORIGIN, ['a=9'], NOW) // 同名覆盖（保持原位置）
    expect(cookiesForOrigin(jar, ORIGIN, NOW)).toBe('a=9; b=2')

    jar = mergeSetCookies(jar, ORIGIN, ['a=; Max-Age=0'], NOW) // 删除
    expect(cookiesForOrigin(jar, ORIGIN, NOW)).toBe('b=2')
  })

  it('过期条目不入回放；修剪后空源消失', () => {
    const jar = mergeSetCookies(emptyJar(), ORIGIN, ['short=1; Max-Age=1'], NOW)
    expect(cookiesForOrigin(jar, ORIGIN, NOW)).toBe('short=1')
    expect(cookiesForOrigin(jar, ORIGIN, NOW + 2000)).toBeNull()
    expect(pruneJar(jar, NOW + 2000).origins[ORIGIN]).toBeUndefined()
  })

  it('单源条目上限：超限丢最旧', () => {
    const headers = Array.from(
      { length: JAR_MAX_PER_ORIGIN + 5 },
      (_, index) => `c${index}=${index}`,
    )
    const jar = mergeSetCookies(emptyJar(), ORIGIN, headers, NOW)
    const cookies = jar.origins[ORIGIN]!
    expect(cookies).toHaveLength(JAR_MAX_PER_ORIGIN)
    expect(cookies[0]?.name).toBe('c5') // 最旧 5 条被裁
    expect(cookies.at(-1)?.name).toBe(`c${JAR_MAX_PER_ORIGIN + 4}`)
  })

  it('源隔离：不同 origin 互不可见', () => {
    const jar = mergeSetCookies(emptyJar(), ORIGIN, ['a=1'], NOW)
    expect(cookiesForOrigin(jar, 'https://other.example', NOW)).toBeNull()
  })
})

describe('parseJar / serializeJar / 容量', () => {
  it('round-trip 保真；坏数据兜底空罐', () => {
    const jar = mergeSetCookies(emptyJar(), ORIGIN, ['a=1; Max-Age=3600'], NOW)
    expect(parseJar(serializeJar(jar))).toEqual(jar)
    expect(parseJar('not-json{')).toEqual(emptyJar())
    expect(parseJar('{"origins":{"x":42}}')).toEqual(emptyJar())
    expect(parseJar(null)).toEqual(emptyJar())
  })

  it('capJarBytes：超限按插入序保留前缀、整源丢弃', () => {
    let jar: CookieJar = emptyJar()
    for (let index = 0; index < 6; index += 1) {
      jar = mergeSetCookies(jar, `https://s${index}.example`, [`v=${'x'.repeat(4000)}`], NOW)
    }
    // 每源 ≈4.1KB：10KB 上限装得下 s0/s1 两源，s2 起整源丢弃。
    const capped = capJarBytes(jar, 10_000)
    expect(serializeJar(capped).length).toBeLessThanOrEqual(10_000)
    expect(capped.origins['https://s0.example']).toBeDefined() // 前缀保留
    expect(capped.origins['https://s1.example']).toBeDefined()
    expect(capped.origins['https://s2.example']).toBeUndefined() // 首个装不下的源起全丢弃
  })

  it('originOf：规范 origin；非法输入 null', () => {
    expect(originOf('https://example.com/a/b?c=1')).toBe('https://example.com')
    expect(originOf('http://example.com:8080/')).toBe('http://example.com:8080')
    expect(originOf('not-a-url')).toBeNull()
  })
})
