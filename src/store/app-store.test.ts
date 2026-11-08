import { beforeEach, describe, expect, it, vi } from 'vitest'

import { permissionManager } from '@/core/permissions'

import {
  getAppManifest,
  installApp,
  registerRuntimeApp,
  resetAppStore,
  restoreInstalledApps,
  uninstallApp,
  unregisterRuntimeApp,
  useAppStore,
} from './app-store'

const VALID_APP = {
  id: 'com.ageha.thirdparty',
  name: 'Third Party',
  version: '1.0.0',
  entry: '/apps/thirdparty/index.html',
  permissions: ['storage'],
}

const INSTALLED_KEY = 'agehaos.apps.installed.v1'

beforeEach(() => {
  localStorage.removeItem(INSTALLED_KEY)
  resetAppStore()
})

describe('app-store', () => {
  it('starts with the built-in apps registered', () => {
    const apps = useAppStore.getState().apps

    expect(apps.map((app) => app.id)).toEqual([
      'com.ageha.notes',
      'com.ageha.files',
      'com.ageha.settings',
      'com.ageha.store',
      'com.ageha.calculator',
      'com.ageha.dynamic.panel',
      'com.ageha.terminal',
      'com.ageha.browser',
      // 羽化 L1 三件套（AI-GENERATED-APPS-DESIGN §3.2）。
      'com.ageha.eclosion.calculator',
      'com.ageha.eclosion.notes',
      'com.ageha.eclosion.clock',
    ])
  })

  it('registers the eclosion trio from the spec table and trusts it like a builtin', () => {
    // Manifest 形状：entry 统一为运行时页（前缀路由到 EclosionAppFrame），
    // permissions/window 与规格表一致；grantAll 静默授权（规格不由 AI 决定）。
    const calculator = getAppManifest('com.ageha.eclosion.calculator')
    expect(calculator).toMatchObject({
      id: 'com.ageha.eclosion.calculator',
      entry: '/apps/runtime/eclosion.html',
      permissions: [],
      window: { width: 300, height: 440, resizable: false },
    })
    const notes = getAppManifest('com.ageha.eclosion.notes')
    expect(notes?.permissions).toEqual(['filesystem.read', 'filesystem.write'])
    expect(permissionManager.has('com.ageha.eclosion.notes', 'filesystem.write')).toBe(true)
    expect(permissionManager.has('com.ageha.eclosion.clock', 'storage')).toBe(true)
    expect(permissionManager.has('com.ageha.eclosion.calculator', 'storage')).toBe(false)
  })

  it('rejects an invalid manifest without registering it', () => {
    const result = installApp({ ...VALID_APP, id: 'not-namespaced' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThan(0)
    expect(getAppManifest('not-namespaced')).toBeNull()
  })

  it('installs a valid new app', () => {
    const result = installApp(VALID_APP)

    expect(result.ok).toBe(true)
    expect(getAppManifest('com.ageha.thirdparty')?.name).toBe('Third Party')
    expect(useAppStore.getState().apps).toHaveLength(12)
  })

  it('rejects installing an app whose id is already registered', () => {
    const result = installApp({
      ...VALID_APP,
      id: 'com.ageha.notes',
      name: 'Another Notes',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.message).toContain('already installed')
    expect(getAppManifest('com.ageha.notes')?.name).toBe('Notes')
  })

  it('uninstalls apps and syncs the store', () => {
    expect(uninstallApp('com.ageha.notes')).toBe(true)
    expect(uninstallApp('com.ageha.notes')).toBe(false)

    expect(getAppManifest('com.ageha.notes')).toBeNull()
    expect(useAppStore.getState().apps).toHaveLength(10)
  })

  it('auto-grants capabilities to trusted built-in apps at boot', () => {
    expect(permissionManager.has('com.ageha.notes', 'storage')).toBe(true)
    expect(permissionManager.has('com.ageha.files', 'filesystem.read')).toBe(true)
    expect(permissionManager.has('com.ageha.files', 'filesystem.write')).toBe(true)
    expect(permissionManager.has('com.ageha.notes', 'network')).toBe(false)
  })

  it('forgets permissions when an app is uninstalled', () => {
    uninstallApp('com.ageha.notes')

    expect(permissionManager.grantedPermissions('com.ageha.notes')).toEqual([])
  })

  it('does not auto-grant third-party installs', () => {
    installApp(VALID_APP)

    expect(permissionManager.grantedPermissions('com.ageha.thirdparty')).toEqual([])
  })
})

describe('installed-app persistence (App Store 重装恢复)', () => {
  it('persists third-party installs and restores them on reboot', () => {
    installApp(VALID_APP)
    const persisted = JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? '[]')
    expect(persisted.map((app: { id: string }) => app.id)).toEqual(['com.ageha.thirdparty'])

    // 模拟重启：完全重建注册表并恢复。
    resetAppStore()
    expect(getAppManifest('com.ageha.thirdparty')?.name).toBe('Third Party')
    expect(useAppStore.getState().apps).toHaveLength(12)
  })

  it('does not persist built-in apps', () => {
    uninstallApp('com.ageha.notes')
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()
  })

  it('does not persist the eclosion trio (会话/按用户缓存生命周期)', () => {
    // 羽化应用的生成产物在 IndexedDB agehaos.eclosion（按 userId 分区），
    // 不进 localStorage 安装表——否则与缓存双源打架。
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()
    resetAppStore()
    expect(getAppManifest('com.ageha.eclosion.calculator')).not.toBeNull()
  })

  it('drops the entry when a third-party app is uninstalled', () => {
    installApp(VALID_APP)
    uninstallApp('com.ageha.thirdparty')

    expect(JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? '[]')).toEqual([])
    resetAppStore()
    expect(getAppManifest('com.ageha.thirdparty')).toBeNull()
  })

  it('skips corrupted restore payloads instead of breaking boot', () => {
    localStorage.setItem(INSTALLED_KEY, '[{"id":"broken"}, "junk", 42]')
    resetAppStore()

    // 非法条目被逐项拒绝，不注册、不崩溃。
    expect(getAppManifest('broken')).toBeNull()
    expect(useAppStore.getState().apps).toHaveLength(11)
  })
})

describe('runtime registration（羽化今日/留存清单，§3.2/§6.4）', () => {
  const TODAY_APP = {
    id: 'com.ageha.eclosion.edge-oracle',
    name: '边缘神谕',
    version: '1.0.0',
    entry: '/apps/runtime/eclosion.html',
    permissions: [],
    window: { width: 720, height: 480, resizable: true },
  }

  it('registers session-scoped manifests that never reach INSTALLED_KEY', () => {
    const result = registerRuntimeApp(TODAY_APP)
    expect(result.ok).toBe(true)
    expect(getAppManifest('com.ageha.eclosion.edge-oracle')?.name).toBe('边缘神谕')
    // 运行时注册不落盘。
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()

    // 其他安装/卸载触发的重写也不会把运行时应用卷进持久表。
    installApp(VALID_APP)
    const persisted = JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? '[]')
    expect(persisted.map((app: { id: string }) => app.id)).toEqual(['com.ageha.thirdparty'])
  })

  it('validates against the frozen manifest schema and rejects dupes', () => {
    expect(registerRuntimeApp({ ...TODAY_APP, evil: true }).ok).toBe(false)
    expect(registerRuntimeApp({ ...TODAY_APP, id: 'Edge-Oracle' }).ok).toBe(false) // 非反域名 id
    expect(registerRuntimeApp(TODAY_APP).ok).toBe(true)
    expect(registerRuntimeApp(TODAY_APP).ok).toBe(false) // 已在册
  })

  it('unregisters runtime apps without touching persisted installs', () => {
    installApp(VALID_APP)
    registerRuntimeApp(TODAY_APP)

    expect(unregisterRuntimeApp('com.ageha.eclosion.not-registered')).toBe(false) // 未注册的 id
    expect(unregisterRuntimeApp('com.ageha.eclosion.edge-oracle')).toBe(true)
    expect(getAppManifest('com.ageha.eclosion.edge-oracle')).toBeNull()
    // 第三方安装不受影响。
    expect(getAppManifest('com.ageha.thirdparty')).not.toBeNull()

    // 运行时注销不清理别人的持久表。
    expect(JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? '[]')).toHaveLength(1)
  })

  it('does not survive resetAppStore (会话级，重启由羽化侧 kept store 重建)', () => {
    registerRuntimeApp(TODAY_APP)
    resetAppStore()
    expect(getAppManifest('com.ageha.eclosion.edge-oracle')).toBeNull()
  })
})

describe('restoreInstalledApps 持久化次数（C1 审查）', () => {
  it('恢复阶段抑制逐条写盘：整轮 restore 至多一次全量重写', async () => {
    const manifest = {
      id: 'com.ageha.thirdparty',
      name: '第三方',
      version: '1.0.0',
      entry: '/apps/sites/third/index.html',
      permissions: [],
      window: { width: 400, height: 300, resizable: true },
    }
    localStorage.setItem(INSTALLED_KEY, JSON.stringify([manifest, manifest, manifest]))
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    try {
      restoreInstalledApps()
      const writes = setItemSpy.mock.calls.filter(([key]) => key === INSTALLED_KEY)
      expect(writes.length).toBeLessThanOrEqual(1)
      const persisted = JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? '[]')
      expect(persisted.map((app: { id: string }) => app.id)).toEqual(['com.ageha.thirdparty'])
    } finally {
      setItemSpy.mockRestore()
    }
  })
})
