import { create } from 'zustand'

import { systemBus } from '@/core/events'
import { permissionManager, resetPermissionManager } from '@/core/permissions'
import { AppRegistry, parseManifest } from '@/core/runtime'
import type { AppManifest, ManifestParseResult } from '@/core/runtime'

import { BUILTIN_APP_MANIFESTS } from '@/apps/builtin-manifests'

interface AppStoreState {
  apps: AppManifest[]
}

const INSTALLED_KEY = 'agehaos.apps.installed.v1'

let registry = new AppRegistry(systemBus)

export const useAppStore = create<AppStoreState>()(() => ({
  apps: registry.list(),
}))

function commit(): void {
  useAppStore.setState({ apps: registry.list() })
}

function builtinIds(): Set<string> {
  return new Set(BUILTIN_APP_MANIFESTS.map((manifest) => (manifest as AppManifest).id))
}

/** Persists non-builtin installed manifests (App Store installs) for the next boot. */
function persistInstalledApps(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const builtins = builtinIds()
    const installed = registry.list().filter((app) => !builtins.has(app.id))
    localStorage.setItem(INSTALLED_KEY, JSON.stringify(installed))
  } catch {
    /* quota or privacy mode: installs stay in memory */
  }
}

/**
 * Re-installs persisted App Store installs (PRD §42 local first). Each entry
 * re-runs full manifest validation; corrupted entries are skipped so a dirty
 * payload can never break boot. Capability grants live in permission-manager's
 * own persistent store.
 */
export function restoreInstalledApps(): void {
  if (typeof localStorage === 'undefined') return
  let raw: string
  try {
    raw = localStorage.getItem(INSTALLED_KEY) ?? ''
  } catch {
    return
  }
  if (raw === '') return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(parsed)) return
  for (const item of parsed) installApp(item)
}

/** Validates and installs an app manifest; returns the validation result. */
export function installApp(input: unknown): ManifestParseResult {
  const result = parseManifest(input)
  if (!result.ok) return result
  const registered = registry.register(result.manifest)
  if (!registered) {
    return {
      ok: false,
      errors: [{ path: 'id', message: `App "${result.manifest.id}" is already installed` }],
    }
  }
  if (!builtinIds().has(result.manifest.id)) persistInstalledApps()
  commit()
  return result
}

export function uninstallApp(appId: string): boolean {
  const removed = registry.unregister(appId)
  if (removed) {
    permissionManager.forgetApp(appId)
    if (!builtinIds().has(appId)) persistInstalledApps()
    commit()
  }
  return removed
}

export function getAppManifest(appId: string): AppManifest | null {
  return registry.get(appId)
}

/**
 * Built-in system apps are trusted (PRD §8.1): install silently and grant
 * their requested capabilities. Third-party installs go through the consent
 * dialog (PRD §10.2) before calling installApp + grant.
 */
export function registerBuiltinApps(): void {
  for (const raw of BUILTIN_APP_MANIFESTS) {
    const result = installApp(raw)
    if (result.ok) {
      permissionManager.grantAll(result.manifest.id, result.manifest.permissions)
    }
  }
}

/** Fresh registry and permissions with the built-ins installed — mirrors boot. */
export function resetAppStore(): void {
  registry = new AppRegistry(systemBus)
  commit()
  resetPermissionManager()
  registerBuiltinApps()
  restoreInstalledApps()
}
