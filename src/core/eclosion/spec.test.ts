import { describe, expect, it } from 'vitest'

import { translate, type Locale } from '../i18n/dictionaries'
import { isAllowedWebAppEntry } from '../apps/web-app'
import { ECLOSION_RUNNER_ENTRY } from '../apps/web-app'

import {
  BASIC_ECLOSION_SPECS,
  BASIC_ECLOSION_SPEC_VERSION,
  ECLOSION_APP_ID_PREFIX,
  ECLOSION_RUNTIME_DEFAULT_WINDOW,
  eclosionAppKind,
  findEclosionSpecByAppId,
  findEclosionSpecBySpecId,
  imagineAppIdForQuery,
  isEclosionAppId,
  normalizeImagineQuery,
} from './spec'

/**
 * 客户端规格表字面量卡门（§5.2）：与服务端表（server/src/eclosion/spec.ts）的
 * ids/appIds/specVersions/permissions 一致性另由 server/test/eclosion.test.ts
 * 读文件比对钉死；这里钉客户端独有的 titleKey/fallback 映射与 ADR 27 边界。
 */
describe('BASIC_ECLOSION_SPECS（客户端副本，§5.2）', () => {
  it('pins the three L1 specs to the design literals', () => {
    expect(
      BASIC_ECLOSION_SPECS.map((spec) => [
        spec.specId,
        spec.appId,
        spec.specVersion,
        spec.permissions,
        spec.window,
      ]),
    ).toEqual([
      ['calculator', 'com.ageha.eclosion.calculator', 2, [], { width: 300, height: 440, resizable: false }],
      [
        'notes',
        'com.ageha.eclosion.notes',
        2,
        ['filesystem.read', 'filesystem.write'],
        { width: 720, height: 480, resizable: true },
      ],
      ['clock', 'com.ageha.eclosion.clock', 2, ['storage'], { width: 420, height: 560, resizable: true }],
    ])
    expect(BASIC_ECLOSION_SPEC_VERSION).toBe(2)
  })

  it('never carries a hint to the client (ADR 27: server-side prompt surface)', () => {
    for (const spec of BASIC_ECLOSION_SPECS) {
      expect('hint' in spec).toBe(false)
    }
  })

  it('resolves title keys in both locales (坑 31 双词典对齐)', () => {
    const locales: Locale[] = ['zh-CN', 'en']
    for (const spec of BASIC_ECLOSION_SPECS) {
      for (const locale of locales) {
        expect(translate(locale, spec.titleKey).length).toBeGreaterThan(0)
      }
    }
  })

  it('maps native fallbacks: calculator/notes components, clock Type B site', () => {
    const byId = (appId: string) => {
      const spec = findEclosionSpecByAppId(appId)
      if (!spec) throw new Error(`spec missing for ${appId}`)
      return spec
    }
    expect(byId('com.ageha.eclosion.calculator').fallback).toEqual({
      kind: 'component',
      component: 'calculator',
    })
    expect(byId('com.ageha.eclosion.notes').fallback).toEqual({ kind: 'component', component: 'notes' })
    // 时钟兜底是同源静态站点：必须通过 /apps/sites/ allowlist（§30.3）。
    const clockFallback = byId('com.ageha.eclosion.clock').fallback
    expect(clockFallback.kind).toBe('web')
    if (clockFallback.kind === 'web') {
      expect(isAllowedWebAppEntry(clockFallback.entry)).toBe(true)
    }
  })

  it('every appId carries the eclosion prefix and finds back its spec', () => {
    for (const spec of BASIC_ECLOSION_SPECS) {
      expect(spec.appId.startsWith(ECLOSION_APP_ID_PREFIX)).toBe(true)
      expect(findEclosionSpecBySpecId(spec.specId)).toBe(spec)
    }
    expect(findEclosionSpecByAppId('com.ageha.notes')).toBeNull()
    expect(findEclosionSpecBySpecId('nope')).toBeNull()
  })

  it('does not treat the runner entry as a sites entry (allowlist 不放宽)', () => {
    expect(isAllowedWebAppEntry(ECLOSION_RUNNER_ENTRY)).toBe(false)
  })
})

describe('isEclosionAppId（WindowFrame 路由前缀，§3.2）', () => {
  it('accepts only the com.ageha.eclosion. prefix', () => {
    expect(isEclosionAppId('com.ageha.eclosion.calculator')).toBe(true)
    expect(isEclosionAppId('com.ageha.eclosion.imagine-abc12345')).toBe(true)
    expect(isEclosionAppId('com.ageha.eclosion')).toBe(false)
    expect(isEclosionAppId('com.ageha.notes')).toBe(false)
    expect(isEclosionAppId('com.ageha.eclosion.evil')).toBe(true) // 前缀路由只选宿主，未知 spec 走原生兜底
  })
})

describe('eclosionAppKind（分域判定，§2 分层/§6.4/§7）', () => {
  it('classifies basic / today / imagine / non-eclosion ids', () => {
    expect(eclosionAppKind('com.ageha.eclosion.calculator')).toBe('basic')
    expect(eclosionAppKind('com.ageha.eclosion.notes')).toBe('basic')
    expect(eclosionAppKind('com.ageha.eclosion.clock')).toBe('basic')
    // L2：今日世界行与「获取」留存的同源 appId。
    expect(eclosionAppKind('com.ageha.eclosion.edge-oracle')).toBe('today')
    // L3：imagine- 子前缀优先于 today。
    expect(eclosionAppKind('com.ageha.eclosion.imagine-1a2b3c4d')).toBe('imagine')
    expect(eclosionAppKind('com.ageha.notes')).toBeNull()
    expect(eclosionAppKind('com.ageha.eclosion')).toBeNull()
  })

  it('ships the L2/L3 default window (720×480 resizable)', () => {
    expect(ECLOSION_RUNTIME_DEFAULT_WINDOW).toEqual({ width: 720, height: 480, resizable: true })
  })
})

// ── 想象应用 appId 派生（§7：com.ageha.eclosion.imagine-<hash8>） ────────────

describe('normalizeImagineQuery / imagineAppIdForQuery（§7 会话缓存键）', () => {
  it('normalizes: trim + 连续空白折叠为单空格 + 小写（同义输入同键）', () => {
    expect(normalizeImagineQuery('  番茄钟   +  白噪音 ')).toBe('番茄钟 + 白噪音')
    expect(normalizeImagineQuery('Pomodoro\tTimer\n')).toBe('pomodoro timer')
    expect(normalizeImagineQuery('')).toBe('')
  })

  it('pins hash8 to the design literals (与服务端 imagineQueryHash 同口径)', () => {
    // 字面量由 node:crypto sha256 预计算；server/test/eclosion.test.ts 用同一批
    // 字面量钉死两侧相关性（照 L1 规格表读文件比对的简化版）。
    expect(imagineAppIdForQuery('番茄钟 + 白噪音')).toBe('com.ageha.eclosion.imagine-e2f0f6c8')
    expect(imagineAppIdForQuery('  番茄钟 + 白噪音  ')).toBe('com.ageha.eclosion.imagine-e2f0f6c8')
    expect(imagineAppIdForQuery('Pomodoro')).toBe('com.ageha.eclosion.imagine-9504bc37')
    expect(imagineAppIdForQuery('pOMODORO')).toBe('com.ageha.eclosion.imagine-9504bc37')
  })

  it('is deterministic and distinct across queries (确定性 + 区分度)', () => {
    const first = imagineAppIdForQuery('番茄钟')
    expect(imagineAppIdForQuery('番茄钟')).toBe(first)
    expect(imagineAppIdForQuery('白噪音')).not.toBe(first)
    // hash8 恒 8 位小写 hex；appId 过 manifest 的 reverse-domain 模式。
    expect(first).toMatch(/^com\.ageha\.eclosion\.imagine-[0-9a-f]{8}$/u)
  })
})
