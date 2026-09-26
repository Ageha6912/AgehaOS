import { systemBus } from '@/core/events'
import { permissionManager } from '@/core/permissions'
import { getLocale, translate } from '@/core/i18n'
import { getAppManifest } from '@/store/app-store'
import { useWindowStore } from '@/store/window-store'

import { componentFor } from './builtin'

/**
 * Launch flow (PRD §24.2): resolve the manifest from the registry, verify
 * every requested capability was granted (default deny, PRD §10.3), then
 * open a window with the manifest's default geometry. Refusals are audited
 * as `permission.denied` events (PRD §30.5).
 *
 * `geometry` lets callers pin the window position (e.g. the auto-opened
 * Dynamic Panel docks to the desktop's right edge); size still comes from
 * the manifest unless overridden here.
 */
export function launchApp(appId: string, geometry?: { x?: number; y?: number }): string | null {
  const manifest = getAppManifest(appId)
  if (!manifest) return null

  const missing = manifest.permissions.filter(
    (permission) => !permissionManager.has(appId, permission),
  )
  if (missing.length > 0) {
    for (const permission of missing) {
      systemBus.emit('permission.denied', { appId, permission })
    }
    return null
  }

  const meta = componentFor(appId)
  const title = meta ? translate(getLocale(), meta.titleKey) : manifest.name

  return useWindowStore.getState().open({
    appId,
    title,
    width: manifest.window?.width,
    height: manifest.window?.height,
    ...geometry,
  })
}
