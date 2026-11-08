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
/** restoreInstalledApps 期间为 true：installApp 不逐条写盘（C1 审查）。 */
let restoringInstalledApps = false

/**
 * 会话级运行时应用（羽化今日世界清单 / 「获取」留存 / P3 想象域）：注册进
 * 注册表供启动器与 launchApp 解析，但**绝不进 INSTALLED_KEY**——跨重启的
 * 持久事实源是羽化自己的 IndexedDB（kept store），登出/跨日由编排器
 * unregister 防陈旧（AI-GENERATED-APPS-DESIGN §3.2：Manifest schema 冻结）。
 */
const runtimeAppIds = new Set<string>()

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
    const installed = registry
      .list()
      .filter((app) => !builtins.has(app.id) && !runtimeAppIds.has(app.id))
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
  // 恢复阶段抑制逐条持久化（C1 审查）：installApp 每次成功都全量重写
  // INSTALLED_KEY——启动 N 条就 N 次写盘，且中途只剩前缀；统一循环后写一次。
  restoringInstalledApps = true
  try {
    for (const item of parsed) installApp(item)
  } finally {
    restoringInstalledApps = false
  }
  persistInstalledApps()
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
  if (!builtinIds().has(result.manifest.id) && !restoringInstalledApps) persistInstalledApps()
  commit()
  return result
}

export function uninstallApp(appId: string): boolean {
  const removed = registry.unregister(appId)
  if (removed) {
    permissionManager.forgetApp(appId)
    // 广播卸载（B2 审查）：window-store 订阅后关闭该应用全部窗口——权限
    // 已撤，窗口不能再以「可编辑文件」的状态残留到下次启动。
    systemBus.emit('app.uninstalled', { appId })
    if (!builtinIds().has(appId)) persistInstalledApps()
    commit()
  }
  return removed
}

/**
 * 运行时注册（羽化今日/留存清单）：与 installApp 同一 manifest 校验
 * （schema 冻结、deepFreeze 照旧），但只进内存注册表——不持久化、不触
 * 权限授予（L2/L3 恒零权限，SDK 桥按 Default Deny 逐请求校验）。
 */
export function registerRuntimeApp(input: unknown): ManifestParseResult {
  const result = parseManifest(input)
  if (!result.ok) return result
  const registered = registry.register(result.manifest)
  if (!registered) {
    return {
      ok: false,
      errors: [{ path: 'id', message: `App "${result.manifest.id}" is already registered` }],
    }
  }
  runtimeAppIds.add(result.manifest.id)
  commit()
  return result
}

/** 运行时注销（登出/跨日/卸载留存）：只动内存注册表，不触碰 INSTALLED_KEY。 */
export function unregisterRuntimeApp(appId: string): boolean {
  if (!runtimeAppIds.has(appId)) return false
  runtimeAppIds.delete(appId)
  const removed = registry.unregister(appId)
  if (removed) commit()
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
  runtimeAppIds.clear()
  commit()
  resetPermissionManager()
  registerBuiltinApps()
  restoreInstalledApps()
}
