import type { EventBus, SystemEventMap } from '@/core/events'

import type { AppManifest } from './manifest'

export type RegistryEventBus = Pick<EventBus<SystemEventMap>, 'emit'>

/**
 * Catalog of installed apps (PRD §9/§24.4). Registration is the final step
 * of the install flow and emits `app.installed`.
 */
export class AppRegistry {
  private apps = new Map<string, AppManifest>()

  constructor(private bus: RegistryEventBus) {}

  register(manifest: AppManifest): boolean {
    if (this.apps.has(manifest.id)) return false
    this.apps.set(manifest.id, manifest)
    this.bus.emit('app.installed', { appId: manifest.id })
    return true
  }

  unregister(appId: string): boolean {
    return this.apps.delete(appId)
  }

  get(appId: string): AppManifest | null {
    return this.apps.get(appId) ?? null
  }

  list(): AppManifest[] {
    return [...this.apps.values()]
  }

  get count(): number {
    return this.apps.size
  }
}
