import { describe, it, expect, vi, beforeEach } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'

import { PermissionManager } from './permission-manager'

function createManager(
  storage: {
    getItem: (k: string) => string | null
    setItem: (k: string, v: string) => void
  } | null,
) {
  const bus = new EventBus<SystemEventMap>()
  const granted = vi.fn()
  const denied = vi.fn()
  bus.on('permission.granted', granted)
  bus.on('permission.denied', denied)
  const manager = new PermissionManager({ bus, storage })
  return { manager, granted, denied }
}

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('PermissionManager', () => {
  it('denies everything by default', () => {
    const { manager } = createManager(null)

    expect(manager.has('com.ageha.notes', 'storage')).toBe(false)
    expect(manager.grantedPermissions('com.ageha.notes')).toEqual([])
  })

  it('grants a permission, emits the event and persists', () => {
    const storage = fakeStorage()
    const { manager, granted } = createManager(storage)

    expect(manager.grant('com.ageha.notes', 'storage')).toBe(true)

    expect(manager.has('com.ageha.notes', 'storage')).toBe(true)
    expect(granted).toHaveBeenCalledWith({
      appId: 'com.ageha.notes',
      permission: 'storage',
    })
    expect(storage.dump()['agehaos.permissions.v1']).toContain('storage')
  })

  it('does not re-emit or re-persist for an already granted permission', () => {
    const storage = fakeStorage()
    const { manager, granted } = createManager(storage)

    manager.grant('com.ageha.notes', 'storage')
    manager.grant('com.ageha.notes', 'storage')

    expect(granted).toHaveBeenCalledTimes(1)
  })

  it('grants a whole set from a manifest', () => {
    const { manager } = createManager(null)

    manager.grantAll('com.ageha.files', ['filesystem.read', 'filesystem.write', 'storage'])

    expect(manager.has('com.ageha.files', 'filesystem.read')).toBe(true)
    expect(manager.has('com.ageha.files', 'filesystem.write')).toBe(true)
    expect(manager.has('com.ageha.files', 'storage')).toBe(true)
    expect(manager.has('com.ageha.files', 'network')).toBe(false)
  })

  it('revokes permissions and emits permission.denied', () => {
    const { manager, denied } = createManager(null)

    manager.grant('com.ageha.notes', 'storage')

    expect(manager.revoke('com.ageha.notes', 'storage')).toBe(true)
    expect(manager.has('com.ageha.notes', 'storage')).toBe(false)
    expect(denied).toHaveBeenCalledWith({
      appId: 'com.ageha.notes',
      permission: 'storage',
    })
    expect(manager.revoke('com.ageha.notes', 'storage')).toBe(false)
  })

  it('rejects unknown permission names', () => {
    const { manager } = createManager(null)

    expect(manager.grant('com.ageha.x', 'root.access' as never)).toBe(false)
    expect(manager.grantedPermissions('com.ageha.x')).toEqual([])
  })

  it('forgets an app and drops all of its grants', () => {
    const { manager } = createManager(null)

    manager.grantAll('com.ageha.files', ['filesystem.read', 'storage'])
    manager.forgetApp('com.ageha.files')

    expect(manager.grantedPermissions('com.ageha.files')).toEqual([])
  })

  it('restores grants from storage on construction', () => {
    const storage = fakeStorage()
    const first = createManager(storage)
    first.manager.grantAll('com.ageha.notes', ['storage', 'clipboard'])

    const second = createManager(storage)

    expect(second.manager.grantedPermissions('com.ageha.notes')).toEqual(['storage', 'clipboard'])
  })

  it('tolerates corrupted persisted state', () => {
    const storage = {
      getItem: () => '{not json',
      setItem: () => {},
    }

    const { manager } = createManager(storage)

    expect(manager.grantedPermissions('com.ageha.notes')).toEqual([])
  })

  it('keeps working when storage writes fail', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const { manager } = createManager(storage)

    expect(() => manager.grant('com.ageha.notes', 'storage')).not.toThrow()
    expect(manager.has('com.ageha.notes', 'storage')).toBe(true)
  })

  it('ignores invalid entries when loading persisted state', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          'com.ageha.ok': ['storage'],
          'com.ageha.bad': ['root.access', 42],
          'com.ageha.worse': 'nope',
        }),
      setItem: () => {},
    }

    const { manager } = createManager(storage)

    expect(manager.has('com.ageha.ok', 'storage')).toBe(true)
    expect(manager.has('com.ageha.bad', 'storage')).toBe(false)
    expect(manager.grantedPermissions('com.ageha.worse')).toEqual([])
  })
})
