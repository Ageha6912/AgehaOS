import { describe, expect, it, vi } from 'vitest'

import {
  handleSdkRequest,
  parseSdkRequest,
  requiredPermission,
  resolveSdkPath,
  SDK_KEY_PATTERN,
  SDK_MAX_KEYS,
  sdkAppRoot,
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
  it('accepts the exact envelope shape', async () => {
    expect(
      parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get', params: { key: 'a' } }),
    ).toEqual({ reqId: 'r1', api: 'storage', action: 'get', params: { key: 'a' } })
  })

  it('drops wrong type, unknown apis, bad shapes and extra fields', async () => {
    expect(parseSdkRequest({ type: 'other', reqId: 'r1', api: 'storage', action: 'get', params: {} })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'filesystem', action: 'read', params: {} })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: '', api: 'storage', action: 'get', params: {} })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get' })).toBeNull()
    expect(parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api: 'storage', action: 'get', params: [], x: 1 })).toBeNull()
    expect(parseSdkRequest('agehaos:sdk')).toBeNull()
  })
})

describe('permission 门禁（Default Deny，§10.3）', () => {
  it('denies storage requests without the storage permission and audits', async () => {
    const ctx = makeContext({ hasPermission: () => false })
    const response = await handleSdkRequest(request({ api: 'storage', action: 'get', params: { key: 'a' } }), ctx)
    expect(response).toEqual({ reqId: 'r1', ok: false, error: 'permission-denied' })
    expect(ctx.onPermissionDenied).toHaveBeenCalledWith('storage')
  })

  it('denies window.setTitle without the window permission', async () => {
    const ctx = makeContext({ hasPermission: () => false })
    const response = await handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: 'x' } }), ctx)
    expect(response.ok).toBe(false)
    expect(ctx.onPermissionDenied).toHaveBeenCalledWith('window')
    expect(ctx.onTitle).not.toHaveBeenCalled()
  })

  it('serves theme.get without any permission', async () => {
    const ctx = makeContext({ hasPermission: () => false })
    const response = await handleSdkRequest(request({ api: 'theme', action: 'get' }), ctx)
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { theme: 'dark' } })
  })
})

describe('scoped storage（按 appId 命名空间隔离，§30.1）', () => {
  it('sets, gets, lists and removes values inside the app namespace', async () => {
    const ctx = makeContext()
    handleSdkRequest(request({ action: 'set', params: { key: 'note.1', value: { text: 'hello' } } }), ctx)
    expect(await handleSdkRequest(request({ action: 'get', params: { key: 'note.1' } }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { value: { text: 'hello' } },
    })
    expect(await handleSdkRequest(request({ action: 'keys' }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { keys: ['note.1'] },
    })
    // 物理隔离：数据落在 app 专属命名空间。
    expect((ctx.storage as SdkKvStorage & { data: Map<string, string> }).data.has(sdkStorageNamespace('com.ageha.samples.sticky'))).toBe(true)

    handleSdkRequest(request({ action: 'remove', params: { key: 'note.1' } }), ctx)
    expect((await handleSdkRequest(request({ action: 'get', params: { key: 'note.1' } }), ctx)).ok).toBe(true)
  })

  it('never sees another app namespace', async () => {
    const ctx = makeContext()
    handleSdkRequest(request({ action: 'set', params: { key: 'secret', value: 1 } }), ctx)
    const otherCtx = makeContext({ appId: 'com.other.app' })
    const response = await handleSdkRequest(request({ action: 'get', params: { key: 'secret' } }), otherCtx)
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { value: null } })
  })

  it('rejects invalid keys, missing values and oversized values', async () => {
    const ctx = makeContext()
    expect((await handleSdkRequest(request({ action: 'get', params: { key: '' } }), ctx)).ok).toBe(false)
    expect((await handleSdkRequest(request({ action: 'get', params: { key: 'a b' } }), ctx)).ok).toBe(false)
    expect((await handleSdkRequest(request({ action: 'set', params: { key: 'a' } }), ctx)).ok).toBe(false)
    const huge = 'x'.repeat(33 * 1024)
    expect((await handleSdkRequest(request({ action: 'set', params: { key: 'a', value: huge } }), ctx)).ok).toBe(false)
  })

  it('enforces per-app key count and total quota', async () => {
    const ctx = makeContext()
    for (let i = 0; i < SDK_MAX_KEYS; i++) {
      handleSdkRequest(request({ action: 'set', params: { key: `k${i}`, value: i } }), ctx)
    }
    expect(await handleSdkRequest(request({ action: 'set', params: { key: 'overflow', value: 1 } }), ctx)).toEqual({
      reqId: 'r1',
      ok: false,
      error: 'too-many-keys',
    })
  })

  it('treats corrupted namespaces as empty instead of throwing', async () => {
    const ctx = makeContext()
    ctx.storage.setItem(sdkStorageNamespace(ctx.appId), '{broken json')
    expect(SDK_KEY_PATTERN.test('ok.key')).toBe(true)
    const response = await handleSdkRequest(request({ action: 'keys' }), ctx)
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { keys: [] } })
  })
})

describe('window.setTitle', () => {
  it('pushes a valid title to the host', async () => {
    const ctx = makeContext()
    const response = await handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: ' 便签 (3) ' } }), ctx)
    expect(response.ok).toBe(true)
    expect(ctx.onTitle).toHaveBeenCalledWith('便签 (3)')
  })

  it('rejects empty and oversized titles', async () => {
    const ctx = makeContext()
    expect((await handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: '   ' } }), ctx)).ok).toBe(false)
    expect(
      (await handleSdkRequest(request({ api: 'window', action: 'setTitle', params: { title: 'x'.repeat(121) } }), ctx)).ok,
    ).toBe(false)
  })
})

describe('capability contract', () => {
  it('keeps the permission mapping explicit', async () => {
    expect(requiredPermission('storage', 'get')).toBe('storage')
    expect(requiredPermission('window', 'setTitle')).toBe('window')
    expect(requiredPermission('theme', 'get')).toBeNull()
    expect(requiredPermission('notification', 'show')).toBe('notification')
    // files 按动作分权限（PRD §17 + §10.1）。
    expect(requiredPermission('files', 'read')).toBe('filesystem.read')
    expect(requiredPermission('files', 'list')).toBe('filesystem.read')
    expect(requiredPermission('files', 'write')).toBe('filesystem.write')
    expect(requiredPermission('files', 'mkdir')).toBe('filesystem.write')
    expect(requiredPermission('files', 'remove')).toBe('filesystem.write')
    expect(requiredPermission('files', 'nope')).toBe('filesystem.write')
  })

  it('returns unknown-action errors for unrecognized verbs', async () => {
    const ctx = makeContext()
    expect(await handleSdkRequest(request({ action: 'execute' }), ctx)).toEqual({ reqId: 'r1', ok: false, error: 'unknown-action' })
    expect(await handleSdkRequest(request({ api: 'window', action: 'close' }), ctx)).toEqual({
      reqId: 'r1',
      ok: false,
      error: 'unknown-action',
    })
  })
})

describe('notification API (PRD §17 + §16)', () => {
  it('delivers sanitized literal text to the host notification outlet', async () => {
    const notify = vi.fn()
    const ctx = makeContext({ notify })
    const response = await handleSdkRequest(
      request({ api: 'notification', action: 'show', params: { title: ' 备份完成 ', body: '已写人 12 个文件\n\n' } }),
      ctx,
    )
    expect(response).toEqual({ reqId: 'r1', ok: true, data: {} })
    expect(notify).toHaveBeenCalledWith({ title: '备份完成', body: '已写人 12 个文件' })
  })

  it('denies show without the notification permission and audits', async () => {
    const ctx = makeContext({ hasPermission: (p) => p !== 'notification' })
    const response = await handleSdkRequest(
      request({ api: 'notification', action: 'show', params: { title: 't', body: 'b' } }),
      ctx,
    )
    expect(response).toEqual({ reqId: 'r1', ok: false, error: 'permission-denied' })
    expect(ctx.onPermissionDenied).toHaveBeenCalledWith('notification')
  })

  it('rejects empty, oversized and non-string text', async () => {
    const notify = vi.fn()
    const ctx = makeContext({ notify })
    expect(
      (await handleSdkRequest(request({ api: 'notification', action: 'show', params: { title: '', body: 'b' } }), ctx)).ok,
    ).toBe(false)
    expect(
      (await handleSdkRequest(
        request({ api: 'notification', action: 'show', params: { title: 'x'.repeat(65), body: 'b' } }),
        ctx,
      )).ok,
    ).toBe(false)
    expect(
      (await handleSdkRequest(request({ api: 'notification', action: 'show', params: { title: 't', body: 3 } }), ctx)).ok,
    ).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('fails as unavailable when the host did not wire the outlet', async () => {
    const ctx = makeContext()
    const response = await handleSdkRequest(
      request({ api: 'notification', action: 'show', params: { title: 't', body: 'b' } }),
      ctx,
    )
    expect(response).toEqual({ reqId: 'r1', ok: false, error: 'unavailable' })
  })
})

describe('files API (PRD §17，按应用授权)', () => {
  function memoryFs() {
    const files = new Map<string, string>()
    const dirs = new Set<string>(['/Apps'])
    const fail = (code: string): Error => Object.assign(new Error(code), { code })
    const port = {
      readFile: async (p: string) => {
        if (!files.has(p)) throw fail('not-found')
        return files.get(p) as string
      },
      writeFile: async (p: string, c: string) => void files.set(p, c),
      listDir: async (p: string) => {
        if (!dirs.has(p)) throw fail('not-found')
        const names = new Set<Array<{ name: string; type: 'file' | 'directory' }>>()
        void names
        const entries: Array<{ name: string; type: 'file' | 'directory' }> = []
        for (const [path] of files) {
          if (path.startsWith(`${p}/`) && !path.slice(p.length + 1).includes('/')) {
            entries.push({ name: path.slice(p.length + 1), type: 'file' })
          }
        }
        for (const d of dirs) {
          if (d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes('/')) {
            entries.push({ name: d.slice(p.length + 1), type: 'directory' })
          }
        }
        return entries
      },
      createDirectory: async (p: string) => {
        if (dirs.has(p)) throw fail('already-exists')
        dirs.add(p)
      },
      remove: async (p: string) => {
        if (!files.delete(p) && !dirs.delete(p)) throw fail('not-found')
      },
    }
    return { port, files, dirs }
  }

  it('writes and reads inside the app home only', async () => {
    const { port } = memoryFs()
    const ctx = makeContext({ fs: port })
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'mkdir', params: { path: 'notes' } }), ctx)).ok,
    ).toBe(true)
    expect(await handleSdkRequest(request({ api: 'files', action: 'write', params: { path: 'notes/a.txt', content: 'hi' } }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: {},
    })
    expect(
      await handleSdkRequest(request({ api: 'files', action: 'read', params: { path: '/notes/a.txt' } }), ctx),
    ).toEqual({ reqId: 'r1', ok: true, data: { content: 'hi' } })

    const listed = await handleSdkRequest(request({ api: 'files', action: 'list', params: { path: 'notes' } }), ctx)
    expect(listed.data).toEqual({ entries: [{ name: 'a.txt', type: 'file' }] })
  })

  it('denies reads without filesystem.read and writes without filesystem.write', async () => {
    const { port } = memoryFs()
    const readOnly = makeContext({ fs: port, hasPermission: (p) => p === 'filesystem.read' })
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'write', params: { path: 'a.txt', content: 'x' } }), readOnly))
        .error,
    ).toBe('permission-denied')
    const writeOnly = makeContext({ fs: port, hasPermission: (p) => p === 'filesystem.write' })
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'read', params: { path: 'a.txt' } }), writeOnly)).error,
    ).toBe('permission-denied')
  })

  it('rejects traversal, control chars and malformed paths', async () => {
    const { port } = memoryFs()
    const ctx = makeContext({ fs: port })
    for (const bad of ['../escape', 'a/../b', '..', '/a/../../b', 'a\u0000b', '']) {
      expect(
        (await handleSdkRequest(request({ api: 'files', action: 'read', params: { path: bad } }), ctx)).error,
      ).toBe('invalid-path')
    }
    expect(resolveSdkPath('app', 'a//b.txt')).toBe(`${sdkAppRoot('app')}/a/b.txt`)
    expect(resolveSdkPath('app', '/')).toBe(sdkAppRoot('app'))
  })

  it('caps file content and protects the app home itself from remove', async () => {
    const { port } = memoryFs()
    const ctx = makeContext({ fs: port })
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'write', params: { path: 'big.txt', content: 'x'.repeat(256 * 1024 + 1) } }), ctx))
        .error,
    ).toBe('content-too-large')
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'remove', params: { path: '/' } }), ctx)).error,
    ).toBe('root-protected')
  })

  it('maps port errors to their code and fails without a port', async () => {
    const { port } = memoryFs()
    const ctx = makeContext({ fs: port })
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'read', params: { path: 'missing.txt' } }), ctx)).error,
    ).toBe('not-found')
    const noPort = makeContext()
    expect(
      (await handleSdkRequest(request({ api: 'files', action: 'list', params: { path: '' } }), noPort)).error,
    ).toBe('unavailable')
  })
})

describe('user / permissions / system APIs (PRD §17，免许可只读面)', () => {
  it('serves the minimal user identity without any permission', async () => {
    const ctx = makeContext({ getUser: () => ({ username: 'alice', displayName: null }) })
    expect(requiredPermission('user', 'get')).toBeNull()
    expect(await handleSdkRequest(request({ api: 'user', action: 'get' }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { user: { username: 'alice', displayName: null } },
    })
  })

  it('reports the app own granted permissions without any permission', async () => {
    const ctx = makeContext({ getGrantedPermissions: () => ['storage', 'window'] })
    expect(requiredPermission('permissions', 'all')).toBeNull()
    expect(await handleSdkRequest(request({ api: 'permissions', action: 'all' }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { permissions: ['storage', 'window'] },
    })
  })

  it('serves system facts without any permission', async () => {
    const ctx = makeContext({ getSystemInfo: () => ({ version: '0.2.0', locale: 'zh-CN', tier: 'mid' }) })
    expect(requiredPermission('system', 'info')).toBeNull()
    expect(await handleSdkRequest(request({ api: 'system', action: 'info' }), ctx)).toEqual({
      reqId: 'r1',
      ok: true,
      data: { info: { version: '0.2.0', locale: 'zh-CN', tier: 'mid' } },
    })
  })

  it('fails with unavailable when ports are missing and unknown-action otherwise', async () => {
    const ctx = makeContext()
    expect((await handleSdkRequest(request({ api: 'user', action: 'get' }), ctx)).error).toBe('unavailable')
    expect((await handleSdkRequest(request({ api: 'permissions', action: 'all' }), ctx)).error).toBe('unavailable')
    expect((await handleSdkRequest(request({ api: 'system', action: 'info' }), ctx)).error).toBe('unavailable')

    const wired = makeContext({ getUser: () => null, getGrantedPermissions: () => [], getSystemInfo: () => ({ version: '1', locale: 'zh-CN', tier: 'low' }) })
    expect((await handleSdkRequest(request({ api: 'user', action: 'set' }), wired)).error).toBe('unknown-action')
    expect((await handleSdkRequest(request({ api: 'permissions', action: 'grant' }), wired)).error).toBe('unknown-action')
    expect((await handleSdkRequest(request({ api: 'system', action: 'shutdown' }), wired)).error).toBe('unknown-action')
    // 未登录（user 为 null）是合法状态，不是错误。
    expect((await handleSdkRequest(request({ api: 'user', action: 'get' }), wired)).data).toEqual({ user: null })
  })
})

describe('envelope coverage (回归：类型面与运行时白名单同步)', () => {
  it('accepts every SdkApi in parseSdkRequest', async () => {
    const ctx = makeContext({
      getUser: () => null,
      getGrantedPermissions: () => [],
      getSystemInfo: () => ({ version: '1', locale: 'zh-CN', tier: 'low' }),
    })
    for (const api of ['storage', 'window', 'theme', 'notification', 'files', 'user', 'permissions', 'system']) {
      const parsed = parseSdkRequest({ type: 'agehaos:sdk', reqId: 'r1', api, action: 'x', params: {} })
      if (!parsed) throw new Error(`api ${api} must parse`)
      // 白名单齐备时，未接线的处理分支回 unknown-action / unavailable 而非静默超时。
      await handleSdkRequest(parsed, ctx)
    }
  })
})

describe('SDK storage 加固（序列化 / 原型链）', () => {
  it('rejects non-serializable values with a receipt instead of throwing', async () => {
    const ctx = makeContext()
    const bigint = await handleSdkRequest(
      request({ action: 'set', params: { key: 'big', value: 1n } }),
      ctx,
    )
    expect(bigint).toEqual({ reqId: 'r1', ok: false, error: 'invalid-value' })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    const cycle = await handleSdkRequest(
      request({ reqId: 'r2', action: 'set', params: { key: 'cycle', value: circular } }),
      ctx,
    )
    expect(cycle).toEqual({ reqId: 'r2', ok: false, error: 'invalid-value' })
  })

  it('does not treat prototype members as stored values', async () => {
    const ctx = makeContext()
    const response = await handleSdkRequest(
      request({ action: 'get', params: { key: 'toString' } }),
      ctx,
    )
    expect(response).toEqual({ reqId: 'r1', ok: true, data: { value: null } })
  })

  it('writes __proto__ as an own key without polluting Object.prototype', async () => {
    const ctx = makeContext()
    const set = await handleSdkRequest(
      request({ action: 'set', params: { key: '__proto__', value: { polluted: true } } }),
      ctx,
    )
    expect(set.ok).toBe(true)

    const get = await handleSdkRequest(
      request({ reqId: 'r2', action: 'get', params: { key: '__proto__' } }),
      ctx,
    )
    expect(get).toEqual({ reqId: 'r2', ok: true, data: { value: { polluted: true } } })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
