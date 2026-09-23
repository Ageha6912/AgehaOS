import { beforeEach, describe, expect, it } from 'vitest'

import { permissionManager } from '@/core/permissions'

import {
  getAppManifest,
  installApp,
  resetAppStore,
  uninstallApp,
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
    ])
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
    expect(useAppStore.getState().apps).toHaveLength(7)
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
    expect(useAppStore.getState().apps).toHaveLength(5)
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
    expect(useAppStore.getState().apps).toHaveLength(7)
  })

  it('does not persist built-in apps', () => {
    uninstallApp('com.ageha.notes')
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()
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
    expect(useAppStore.getState().apps).toHaveLength(6)
  })
})
