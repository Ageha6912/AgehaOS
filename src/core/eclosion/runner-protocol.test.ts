import { describe, expect, it } from 'vitest'

import {
  ECLOSION_CHUNK_TYPE,
  ECLOSION_POWER_ON_TYPE,
  ECLOSION_ERROR_TYPE,
  ECLOSION_RENDERED_TYPE,
  parseHostToRunnerMessage,
  parseRunnerToHostMessage,
  sdkCapabilitiesForPermissions,
} from './runner-protocol'

const THEME_ONLY = { apis: ['theme'] } as const

describe('runner → 宿主：恰四类消息（§4.1 第 3 条）', () => {
  it('accepts the four whitelisted types with exact shapes', () => {
    expect(parseRunnerToHostMessage({ type: 'agehaos:ready' })).toEqual({ type: 'agehaos:ready' })
    expect(parseRunnerToHostMessage({ type: 'eclosion:rendered' })).toEqual({ type: 'eclosion:rendered' })
    expect(parseRunnerToHostMessage({ type: 'eclosion:error', message: 'Uncaught Error: boom' })).toEqual({
      type: 'eclosion:error',
      message: 'Uncaught Error: boom',
    })
    expect(
      parseRunnerToHostMessage({
        type: 'agehaos:sdk',
        reqId: 'r1',
        api: 'storage',
        action: 'get',
        params: { key: 'k' },
      }),
    ).toEqual({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get', params: { key: 'k' } })
  })

  it('drops unknown types (never falls through to a looser parse)', () => {
    expect(parseRunnerToHostMessage({ type: 'eclosion:chunk', seq: 0, html: '<p>x</p>' })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'eclosion:power-on', scripts: [] })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'agehaos:hello' })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'agehaos:exec', cmd: 'x' })).toBeNull()
    expect(parseRunnerToHostMessage({ type: '__proto__' })).toBeNull()
  })

  it('drops extra fields on every type', () => {
    expect(parseRunnerToHostMessage({ type: 'agehaos:ready', extra: 1 })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'eclosion:rendered', at: 123 })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'eclosion:error', message: 'x', stack: '...' })).toBeNull()
    expect(
      parseRunnerToHostMessage({ type: 'agehaos:sdk', reqId: 'r1', api: 'theme', action: 'get', params: {}, sneaky: true }),
    ).toBeNull()
  })

  it('drops wrong-typed fields and malformed payloads', () => {
    expect(parseRunnerToHostMessage({ type: 'eclosion:error', message: 42 })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'eclosion:error', message: null })).toBeNull()
    expect(parseRunnerToHostMessage('eclosion:rendered')).toBeNull()
    expect(parseRunnerToHostMessage(null)).toBeNull()
    expect(parseRunnerToHostMessage(42)).toBeNull()
    expect(parseRunnerToHostMessage(['agehaos:ready'])).toBeNull()
    // agehaos:sdk 的形状错误同样被 SDK 桥解析拒绝。
    expect(parseRunnerToHostMessage({ type: 'agehaos:sdk', reqId: '', api: 'theme', action: 'get', params: {} })).toBeNull()
    expect(parseRunnerToHostMessage({ type: 'agehaos:sdk', reqId: 'r', api: 'eval', action: 'run', params: {} })).toBeNull()
  })
})

describe('宿主 → runner：恰四类消息', () => {
  it('accepts the four whitelisted types with exact shapes', () => {
    expect(parseHostToRunnerMessage({ type: 'agehaos:hello' })).toEqual({ type: 'agehaos:hello' })
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: 0, html: '<p>x</p>' })).toEqual({
      type: ECLOSION_CHUNK_TYPE,
      seq: 0,
      html: '<p>x</p>',
    })
    expect(
      parseHostToRunnerMessage({
        type: ECLOSION_POWER_ON_TYPE,
        scripts: ['var a = 1', 'var b = 2'],
        capabilities: { apis: ['theme', 'files'] },
      }),
    ).toEqual({
      type: ECLOSION_POWER_ON_TYPE,
      scripts: ['var a = 1', 'var b = 2'],
      capabilities: { apis: ['theme', 'files'] },
    })
    expect(parseHostToRunnerMessage({ type: 'agehaos:sdk-result', reqId: 'r1', ok: true, data: { value: 1 } })).toEqual({
      type: 'agehaos:sdk-result',
      reqId: 'r1',
      ok: true,
      data: { value: 1 },
    })
    expect(parseHostToRunnerMessage({ type: 'agehaos:sdk-result', reqId: 'r1', ok: false, error: 'permission-denied' })).toEqual({
      type: 'agehaos:sdk-result',
      reqId: 'r1',
      ok: false,
      error: 'permission-denied',
    })
  })

  it('drops unknown types and runner-only types', () => {
    expect(parseHostToRunnerMessage({ type: 'agehaos:ready' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_RENDERED_TYPE })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_ERROR_TYPE, message: 'x' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: 'eclosion:exec', code: 'x' })).toBeNull()
  })

  it('requires a well-formed capabilities declaration on power-on (§4.1 第 4 条)', () => {
    const scripts = ['var a = 1']
    // 缺 capabilities / 坏形状 / 白名单外 / 重复 / 空——全部拒绝。
    expect(parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: {} })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: { apis: [] } })).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: { apis: 'storage' } }),
    ).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: { apis: ['theme', 'theme'] } }),
    ).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: { apis: ['theme', 'user'] } }),
    ).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: { apis: ['theme'], extra: 1 } }),
    ).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: THEME_ONLY }),
    ).toEqual({ type: ECLOSION_POWER_ON_TYPE, scripts, capabilities: { apis: ['theme'] } })
  })

  it('drops extra fields on every type', () => {
    expect(parseHostToRunnerMessage({ type: 'agehaos:hello', v: 1 })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: 0, html: '', extra: true })).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts: [], capabilities: THEME_ONLY, run: 'now' }),
    ).toBeNull()
    expect(parseHostToRunnerMessage({ type: 'agehaos:sdk-result', reqId: 'r', ok: true, data: 1, error: 'x' })).toBeNull()
  })

  it('validates field types strictly', () => {
    // seq：非负安全整数。
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: -1, html: '' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: 1.5, html: '' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: '0', html: '' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: Number.NaN, html: '' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_CHUNK_TYPE, seq: 0, html: 42 })).toBeNull()
    // scripts：字符串数组。
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts: 'var a', capabilities: THEME_ONLY }),
    ).toBeNull()
    expect(parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts: [1], capabilities: THEME_ONLY })).toBeNull()
    expect(
      parseHostToRunnerMessage({ type: ECLOSION_POWER_ON_TYPE, scripts: [null], capabilities: THEME_ONLY }),
    ).toBeNull()
    // sdk-result：ok 必为 boolean；失败必须带非空 error。
    expect(parseHostToRunnerMessage({ type: 'agehaos:sdk-result', reqId: 'r', ok: 'yes' })).toBeNull()
    expect(parseHostToRunnerMessage({ type: 'agehaos:sdk-result', reqId: 'r', ok: false })).toBeNull()
    expect(parseHostToRunnerMessage({ type: 'agehaos:sdk-result', reqId: '', ok: true })).toBeNull()
  })
})

describe('sdkCapabilitiesForPermissions（规格权限 → 能力声明，§4.1 第 4 条）', () => {
  it('恒含免许可只读 theme；空权限（L2/L3 / 计算器）仅 theme', () => {
    expect(sdkCapabilitiesForPermissions([])).toEqual({ apis: ['theme'] })
  })

  it('L1 按各自 permissions 推导（顺序确定）', () => {
    // notes：filesystem.read+write → files。
    expect(sdkCapabilitiesForPermissions(['filesystem.read', 'filesystem.write'])).toEqual({
      apis: ['theme', 'files'],
    })
    // clock：storage。
    expect(sdkCapabilitiesForPermissions(['storage'])).toEqual({ apis: ['theme', 'storage'] })
    // 只读文件权限同样点亮 files 命名空间（动作级差异由宿主逐请求裁决）。
    expect(sdkCapabilitiesForPermissions(['filesystem.read'])).toEqual({ apis: ['theme', 'files'] })
    // 全量授权（假想规格）：顺序固定 theme/storage/window/notification/files。
    expect(
      sdkCapabilitiesForPermissions(['notification', 'window', 'storage', 'filesystem.write']),
    ).toEqual({ apis: ['theme', 'storage', 'window', 'notification', 'files'] })
  })
})
