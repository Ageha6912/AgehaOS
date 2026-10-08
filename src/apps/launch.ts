import { systemBus } from '@/core/events'
import { permissionManager } from '@/core/permissions'
import { getLocale, translate } from '@/core/i18n'
import { findEclosionSpecByAppId } from '@/core/eclosion/spec'
import { getAppManifest } from '@/store/app-store'
import { useUsageStore } from '@/store/usage-store'
import { useWindowStore } from '@/store/window-store'

import { componentFor } from './builtin'

/**
 * 本地化展示名解析（launch 与启动器共用）：内置组件 → APP_UI_META.titleKey；
 * 羽化应用（不在 APP_UI_META）→ 规格表 titleKey；其余回落 manifest.name。
 */
export function appDisplayName(appId: string): string {
  const meta = componentFor(appId)
  if (meta) return translate(getLocale(), meta.titleKey)
  const spec = findEclosionSpecByAppId(appId)
  if (spec) return translate(getLocale(), spec.titleKey)
  return getAppManifest(appId)?.name ?? appId
}

/**
 * 显式启动几何：缺省 = 桌面级联/工作区数学（下方 railLeft/wsWidth 一段）；
 * 传入 x/y = 系统钉位；传入 width/height = 调用方自证尺寸（M1-6 移动
 * AppHost 全屏几何——device-store viewport 全宽高），原样透传给窗口引擎、
 * 绕开桌面工作区钳制（移动视口没有桌面浮轨/菜单栏）。
 */
export interface LaunchGeometry {
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Launch flow (PRD §24.2): resolve the manifest from the registry, verify
 * every requested capability was granted (default deny, PRD §10.3), then
 * open a window with the manifest's default geometry. Refusals are audited
 * as `permission.denied` events (PRD §30.5).
 *
 * `geometry` lets callers pin the window position (系统钉位调用；2026-10-02 起
 * 桌面不再自动开窗); size still comes from
 * the manifest unless overridden here. 小视口钳制（§25）：初始尺寸不超过
 * 视口（桌面优先 1280+，此为窄屏兜底，不改变核心窗口管理器语义）。
 * 显式 geometry.width/height 覆盖钳制结果（M1-6 移动全屏，调用方对几何
 * 全权负责）。
 *
 * `source='user'` 记入「最近使用」（usage-store，§22 P2-5）；桌面自动开窗
 * 等系统行为传 'system' 不记录。
 */
export function launchApp(
  appId: string,
  geometry?: LaunchGeometry,
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

  const title = appDisplayName(appId)

  // 工作区（2026-10-03 裁决「单栏拉长」连带）：左右浮轨拉长后常驻占据两侧
  // （左组 16+150；右小组件栏 xl 断点起 20+296）——窗口宽度钳到工作区内宽、
  // 位置在工作区内居中（级联错位保留在 y 向）。轨道宽度从 Token 实测，
  // 不经模块导入（apps 层不得反向依赖 desktop 层）。
  const rootStyle = getComputedStyle(document.documentElement)
  const railLeft = window.innerWidth >= 640
    ? (parseFloat(rootStyle.getPropertyValue('--ag-rail-left-width')) || 0) + 24 // left-4 + 8 缓冲
    : 8 // <640 左组隐藏（sm:flex 断点）
  const railRight = window.innerWidth >= 1280
    ? (parseFloat(rootStyle.getPropertyValue('--ag-rail-right-width')) || 0) + 28 // right-5 + 8 缓冲
    : 8
  const wsWidth = Math.max(320, window.innerWidth - railLeft - railRight)
  const wsTop = 40 // 菜单栏 32 + 8
  const wsBottom = window.innerHeight - 96 // Dock 68 + gap 20 + 8

  // 尺寸钳到工作区内宽/内高（窄屏兜底原语义，边界改为工作区）。
  const width = Math.max(
    320,
    Math.min(manifest.window?.width ?? Number.MAX_SAFE_INTEGER, wsWidth - 16),
  )
  const height = Math.max(
    200,
    Math.min(manifest.window?.height ?? Number.MAX_SAFE_INTEGER, wsBottom - wsTop),
  )

  const windowId = useWindowStore.getState().open({
    appId,
    title,
    width,
    height,
    ...geometry,
  })
  if (windowId !== null && !geometry) {
    // 无显式几何：工作区内水平居中（级联 y 错位钳进工作区纵带）。
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const created = useWindowStore
      .getState()
      .windows.find((win) => win.id === windowId)
    if (created) {
      const x = railLeft + 8 + Math.max(0, (wsWidth - 16 - created.width) / 2)
      const y = Math.max(wsTop, Math.min(wsBottom - created.height, created.y))
      if (x !== created.x || y !== created.y) {
        useWindowStore.getState().move(windowId, x, y, viewport)
      }
    }
  }
  if (windowId !== null && source === 'user') {
    useUsageStore.getState().recordRecentApp(appId)
  }
  return windowId
}
