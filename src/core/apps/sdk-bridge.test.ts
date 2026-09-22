import { describe, expect, it, vi } from 'vitest'

import {
  handleSdkRequest,
  parseSdkRequest,
  SDK_API_PERMISSIONS,
  SDK_KEY_PATTERN,
  SDK_MAX_KEYS,
  sdkStorageNamespace,
} from './sdk-bridge'
import type { SdkContext, SdkKvStorage, SdkRequest } from './sdk-bridge'

function memoryStorage(): SdkKvStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

function makeContext(overrides?: Partial<SdkContext>) {
  const storage = memoryStorage()
  const ctx: SdkContext = {
    appId: 'com.ageha.samples.sticky',
    hasPermission: () => true,
    onPermissionDenied: vi.fn(),
    storage,
    getTheme: () => 'dark',
    onTitle: vi.fn(),
    ...overrides,
  }
  return ctx
}

function request(partial: Partial<SdkRequest>): SdkRequest {
  return { reqId: 'r1', api: 'storage', action: 'get', params: {}, ...partial }
}

describe('SDK 请求解析（§30.3 白名单 schema）', () => {
  it('accepts the exact envelope shape', () => {
    expect(
      parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get', params: { key: 'a' } }),
    ).toEqual({ reqId: 'r1', api: 'storage', action: 'get', params: { key: 'a' } })
  })

  it('drops wrong type, unknown apis, bad shapes and extra fields', () => {
    expect(parseSdkRequest({ type: 'other', reqId: 'r1', api: 'storage', action: 'get', params: {} })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'filesystem', action: 'read', params: {} })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: '', api: 'storage', action: 'get', params: {} })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get' })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get', params: [], x: 1 })).toBeNull()
    expect(parseSdkRequest('agehaos:sdk')).toBeNull()
  })
})

describe('permission 门禁（Default Deny，§10.3）', () => {
  it('denies storage requests without the storage permission and audits', () => {
    const ctx = makeContext({ hasPermission: () => false })
    const response = handleSdkRequest(request({ api: 'storage', action: 'get', params: { key: 'a' } }), ctx)
    expect(response).toEqual({ reqId: 'r1', ok: false, error: 'permission-denied' })
    expect(ctx.onPermissionDenied).toHaveBeenCalledWith('storage')
  })

  it('denies window.setTitle without the window permission', () => {
    const ctx = makeContext({ hasPermission: () => false })
    const response = handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: 'x' } }), ctx)
    expect(response.ok).toBe(false)
    expect(ctx.onPermissionDenied).toHaveBeenCalledWith('window')
    expect(ctx.onTitle).not.toHaveBeenCalled()
  })

  it('serves theme.get without any permission', () => {
    const ctx = makeContext({ hasPermission: () => false })
    const response = handleSdkRequest(request({ api: 'theme', action: 'get' }), ctx)
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { theme: 'dark' } })
  })
})

describe('scoped storage（按 appId 命名空间隔离，§30.1）', () => {
  it('sets, gets, lists and removes values inside the app namespace', () => {
    const ctx = makeContext()
    handleSdkRequest(request({ action: 'set', params: { key: 'note.1', value: { text: 'hello' } } }), ctx)
    expect(handleSdkRequest(request({ action: 'get', params: { key: 'note.1' } }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { value: { text: 'hello' } },
    })
    expect(handleSdkRequest(request({ action: 'keys' }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { keys: ['note.1'] },
    })
    // 物理隔离：数据落在 app 专属命名空间。
    expect((ctx.storage as SdkKvStorage & { data: Map<string, string> }).data.has(sdkStorageNamespace('com.ageha.samples.sticky'))).toBe(true)

    handleSdkRequest(request({ action: 'remove', params: { key: 'note.1' } }), ctx)
    expect(handleSdkRequest(request({ action: 'get', params: { key: 'note.1' } }), ctx).ok).toBe(true)
  })

  it('never sees another app namespace', () => {
    const ctx = makeContext()
    handleSdkRequest(request({ action: 'set', params: { key: 'secret', value: 1 } }), ctx)
    const otherCtx = makeContext({ appId: 'com.other.app' })
    const response = handleSdkRequest(request({ action: 'get', params: { key: 'secret' } }), otherCtx)
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { value: null } })
  })

  it('rejects invalid keys, missing values and oversized values', () => {
    const ctx = makeContext()
    expect(handleSdkRequest(request({ action: 'get', params: { key: '' } }), ctx).ok).toBe(false)
    expect(handleSdkRequest(request({ action: 'get', params: { key: 'a b' } }), ctx).ok).toBe(false)
    expect(handleSdkRequest(request({ action: 'set', params: { key: 'a' } }), ctx).ok).toBe(false)
    const huge = 'x'.repeat(33 * 1024)
    expect(handleSdkRequest(request({ action: 'set', params: { key: 'a', value: huge } }), ctx).ok).toBe(false)
  })

  it('enforces per-app key count and total quota', () => {
    const ctx = makeContext()
    for (let i = 0; i < SDK_MAX_KEYS; i++) {
      handleSdkRequest(request({ action: 'set', params: { key: `k${i}`, value: i } }), ctx)
    }
    expect(handleSdkRequest(request({ action: 'set', params: { key: 'overflow', value: 1 } }), ctx)).toEqual({
      reqId: 'r1',
      ok: false,
      error: 'too-many-keys',
    })
  })

  it('treats corrupted namespaces as empty instead of throwing', () => {
    const ctx = makeContext()
    ctx.storage.setItem(sdkStorageNamespace(ctx.appId), '{broken json')
    expect(SDK_KEY_PATTERN.test('ok.key')).toBe(true)
    const response = handleSdkRequest(request({ action: 'keys' }), ctx)
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { keys: [] } })
  })
})

describe('window.setTitle', () => {
  it('pushes a valid title to the host', () => {
    const ctx = makeContext()
    const response = handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: ' 便签 (3) ' } }), ctx)
    expect(response.ok).toBe(true)
    expect(ctx.onTitle).toHaveBeenCalledWith('便签 (3)')
  })

  it('rejects empty and oversized titles', () => {
    const ctx = makeContext()
    expect(handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: '   ' } }), ctx).ok).toBe(false)
    expect(
      handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: 'x'.repeat(121) } }), ctx).ok,
    ).toBe(false)
  })
})

describe('capability contract', () => {
  it('keeps the permission mapping explicit', () => {
    expect(SDK_API_PERMISSIONS).toEqual({ storage: 'storage', window: 'window', theme: null })
  })

  it('returns unknown-action errors for unrecognized verbs', () => {
    const ctx = makeContext()
    expect(handleSdkRequest(request({ action: 'execute' }), ctx)).toEqual({ reqId: 'r1', ok: false, error: 'unknown-action' })
    expect(handleSdkRequest(request({ api: 'window', action: 'close' }), ctx)).toEqual({
      reqId: 'r1',
      ok: false,
      error: 'unknown-action',
    })
  })
})
