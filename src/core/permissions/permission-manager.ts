import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

import { isKnownPermission } from './constants'
import type { Permission } from './constants'

const STORAGE_KEY = 'agehaos.permissions.v1'

export interface PermissionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PermissionManagerOptions {
  bus?: Pick<EventBus<SystemEventMap>, 'emit'>
  /** `null` disables persistence (in-memory only). */
  storage?: PermissionStorage | null
}

type SerializeState = Record<string, Permission[]>

function defaultStorage(): PermissionStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* storage access denied */
  }
  return null
}

/**
 * App-capability grants (PRD §10/§13.2). Default deny: an app has exactly
 * the permissions explicitly granted to it — never what its manifest asks
 * for. Decisions persist across reloads (PRD §42 local first).
 */
export class PermissionManager {
  private grants = new Map<string, Set<Permission>>()
  private bus: Pick<EventBus<SystemEventMap>, 'emit'>
  private storage: PermissionStorage | null

  constructor(options: PermissionManagerOptions = {}) {
    this.bus = options.bus ?? systemBus
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
    this.load()
  }

  grant(appId: string, permission: Permission): boolean {
    if (!isKnownPermission(permission)) return false
    let set = this.grants.get(appId)
    if (!set) {
      set = new Set()
      this.grants.set(appId, set)
    }
    const added = !set.has(permission)
    set.add(permission)
    if (added) {
      this.bus.emit('permission.granted', { appId, permission })
      this.persist()
    }
    return true
  }

  grantAll(appId: string, permissions: readonly Permission[]): void {
    for (const permission of permissions) this.grant(appId, permission)
  }

  revoke(appId: string, permission: Permission): boolean {
    const set = this.grants.get(appId)
    if (!set || !set.has(permission)) return false
    set.delete(permission)
    if (set.size === 0) this.grants.delete(appId)
    this.bus.emit('permission.denied', { appId, permission })
    this.persist()
    return true
  }

  has(appId: string, permission: Permission): boolean {
    return this.grants.get(appId)?.has(permission) ?? false
  }

  grantedPermissions(appId: string): Permission[] {
    const set = this.grants.get(appId)
    return set ? [...set] : []
  }

  forgetApp(appId: string): void {
    if (this.grants.delete(appId)) this.persist()
  }

  clear(): void {
    this.grants.clear()
    this.persist()
  }

  private load(): void {
    if (!this.storage) return
    const raw = this.storage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as SerializeState
      if (typeof parsed !== 'object' || parsed === null) return
      for (const [appId, permissions] of Object.entries(parsed)) {
        if (!Array.isArray(permissions)) continue
        const valid = permissions.filter(isKnownPermission)
        if (valid.length > 0) this.grants.set(appId, new Set(valid))
      }
    } catch {
      /* corrupted state: start from default-deny */
    }
  }

  private persist(): void {
    if (!this.storage) return
    const state: SerializeState = {}
    for (const [appId, set] of this.grants) state[appId] = [...set]
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* quota or privacy mode: grants stay in memory */
    }
  }
}

/** Process-level manager backed by localStorage. */
export const permissionManager = new PermissionManager()

export function resetPermissionManager(): void {
  permissionManager.clear()
}
