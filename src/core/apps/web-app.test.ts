import { describe, expect, it } from 'vitest'

import {
  ECLOSION_RUNNER_ENTRY,
  hostHelloMessage,
  isAllowedWebAppEntry,
  isEclosionRunnerEntry,
  parseAppMessage,
  WEB_APP_ENTRY_PREFIX,
  WEB_APP_SANDBOX,
} from './web-app'

describe('Type B 来源 allowlist（§30.3）', () => {
  it('accepts bundled same-origin site entries', () => {
    expect(isAllowedWebAppEntry('/apps/sites/clock/index.html')).toBe(true)
    expect(isAllowedWebAppEntry('/apps/sites/paint/studio.html')).toBe(true)
  })

  it('rejects external and protocol-relative URLs', () => {
    expect(isAllowedWebAppEntry('https://evil.example.com/app.html')).toBe(false)
    expect(isAllowedWebAppEntry('http://evil.example.com/a.html')).toBe(false)
    expect(isAllowedWebAppEntry('//evil.example.com/a.html')).toBe(false)
  })

  it('rejects path traversal and malformed paths', () => {
    expect(isAllowedWebAppEntry('/apps/sites/../secret.html')).toBe(false)
    expect(isAllowedWebAppEntry('/apps/sites/a/../../secret.html')).toBe(false)
    expect(isAllowedWebAppEntry('/apps/sites//double.html')).toBe(false)
    expect(isAllowedWebAppEntry('/apps/sites\\windows.html')).toBe(false)
    expect(isAllowedWebAppEntry('/apps/sites/clock/')).toBe(false)
    expect(isAllowedWebAppEntry('/apps/sites/clock/index.js')).toBe(false)
    expect(isAllowedWebAppEntry('/other/clock/index.html')).toBe(false)
  })
})

describe('羽化运行时 entry（AI-GENERATED-APPS-DESIGN §3.2）', () => {
  it('pins the runner entry to the exact runtime URL', () => {
    expect(ECLOSION_RUNNER_ENTRY).toBe('/apps/runtime/eclosion.html')
  })

  it('accepts only the exact entry — no prefixes, queries or traversal variants', () => {
    expect(isEclosionRunnerEntry(ECLOSION_RUNNER_ENTRY)).toBe(true)
    expect(isEclosionRunnerEntry('/apps/runtime/eclosion.html?v=3')).toBe(false)
    expect(isEclosionRunnerEntry('/apps/runtime/eclosion.html/')).toBe(false)
    expect(isEclosionRunnerEntry('/apps/runtime/eclosion.html/../evil.html')).toBe(false)
    expect(isEclosionRunnerEntry('/apps/runtime/')).toBe(false)
    expect(isEclosionRunnerEntry('/apps/runtime/other.html')).toBe(false)
    expect(isEclosionRunnerEntry('https://evil.example.com/apps/runtime/eclosion.html')).toBe(false)
  })

  it('keeps the runner entry outside the /apps/sites/ allowlist（两套判定互不放宽）', () => {
    expect(isAllowedWebAppEntry(ECLOSION_RUNNER_ENTRY)).toBe(false)
    // 反向：sites 条目也不被羽化判定接受。
    expect(isEclosionRunnerEntry('/apps/sites/clock/index.html')).toBe(false)
  })
})

describe('iframe sandbox 契约', () => {
  it('allows scripts but never same-origin', () => {
    expect(WEB_APP_SANDBOX).toBe('allow-scripts')
    expect(WEB_APP_SANDBOX).not.toContain('allow-same-origin')
    expect(WEB_APP_SANDBOX).not.toContain('allow-top-navigation')
    expect(WEB_APP_SANDBOX).not.toContain('allow-popups')
  })
})

describe('postMessage 协议校验（§30.3）', () => {
  it('accepts the exact ready message and returns a normalized value', () => {
    expect(parseAppMessage({ type: 'agehaos:ready' })).toEqual({ type: 'agehaos:ready' })
  })

  it('drops unknown types and malformed payloads', () => {
    expect(parseAppMessage({ type: 'agehaos:exec', cmd: 'rm -rf /' })).toBeNull()
    expect(parseAppMessage({ type: 'agehaos:ready', extra: 1 })).toBeNull()
    expect(parseAppMessage({ type: 42 })).toBeNull()
    expect(parseAppMessage('agehaos:ready')).toBeNull()
    expect(parseAppMessage(null)).toBeNull()
    expect(parseAppMessage(['agehaos:ready'])).toBeNull()
  })

  it('freezes the host hello message', () => {
    const hello = hostHelloMessage()
    expect(hello.type).toBe('agehaos:hello')
    expect(Object.isFrozen(hello)).toBe(true)
    expect(WEB_APP_ENTRY_PREFIX).toBe('/apps/sites/')
  })
})
