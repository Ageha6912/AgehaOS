import { systemBus } from '@/core/events'
import { permissionManager } from '@/core/permissions'
import { getLocale, translate } from '@/core/i18n'
import { getAppManifest } from '@/store/app-store'
import { useUsageStore } from '@/store/usage-store'
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
 * the manifest unless overridden here. 小视口钳制（§25）：初始尺寸不超过
 * 视口（桌面优先 1280+，此为窄屏兜底，不改变核心窗口管理器语义）。
 *
 * `source='user'` 记入「最近使用」（usage-store，§22 P2-5）；桌面自动开窗
 * 等系统行为传 'system' 不记录。
 */
export function launchApp(
  appId: string,
  geometry?: { x?: number; y?: number },
  source: 'user' | 'system' = 'user',
): string | null {
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

  // 窄屏兜底：manifest 默认尺寸可能超过视口（如 375px 手机宽度 < 900px 窗口）。
  const maxWidth = Math.max(320, window.innerWidth - 16)
  const maxHeight = Math.max(240, window.innerHeight - 48)
  const width =
    manifest.window?.width !== undefined ? Math.min(manifest.window.width, maxWidth) : undefined
  const height =
    manifest.window?.height !== undefined ? Math.min(manifest.window.height, maxHeight) : undefined

  const windowId = useWindowStore.getState().open({
    appId,
    title,
    width,
    height,
    ...geometry,
  })
  if (windowId !== null && source === 'user') {
    useUsageStore.getState().recordRecentApp(appId)
  }
  return windowId
}
