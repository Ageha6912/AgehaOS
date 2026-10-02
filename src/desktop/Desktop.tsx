import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { AtmosphereLayer } from '@/desktop/atmosphere/AtmosphereLayer'
import { DesktopBranding } from '@/desktop/branding/DesktopBranding'
import { MenuBar } from '@/desktop/menu-bar/MenuBar'
import { Sidebar } from '@/desktop/sidebar/Sidebar'
import { Taskbar } from '@/desktop/taskbar/Taskbar'
import { WindowLayer } from '@/desktop/window/WindowLayer'
import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { NotificationToasts } from '@/desktop/NotificationToasts'
import { SearchPalette } from '@/desktop/search/SearchPalette'
import { ContextMenu, type ContextMenuPosition } from '@/desktop/ContextMenu'
import { openRandomGame } from '@/desktop/game-rotation'
import { WidgetRail } from '@/desktop/widgets/WidgetRail'
import {
  MENUBAR_HEIGHT_PX,
  RAIL_RIGHT_BREAKPOINT_PX,
  RAIL_RIGHT_WIDTH_PX,
} from '@/desktop/window/viewport'
import { useCursorGlow } from '@/desktop/motion/use-cursor-glow'
import { useAurora } from '@/desktop/motion/use-aurora'
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useSettingsStore, type ThemePreference } from '@/store/settings-store'
import { getAppManifest } from '@/store/app-store'
import { useWindowStore } from '@/store/window-store'

/** 动态面板默认开启（2026-09-26 用户裁决）：进入桌面自动打开的仪表盘。 */
const AUTO_OPEN_APP_ID = 'com.ageha.dynamic.panel'

function resolveDark(preference: ThemePreference): boolean {
  if (preference === 'dark') return true
  if (preference === 'system') {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    )
  }
  return false
}

export function Desktop() {
  // 壁纸层常驻（§32）：照片基底出厂默认，field 覆盖层由层内按动态桌面
  // 状态渲染——桌面关闭动态桌面时回落照片（不再回落纯画布渐变）。
  // 桌面增强动效（DESIGN.md §15/§32.5 修订 10）：光晕 + 进阶炫技档，
  // 2026-10-01 用户裁决默认全开（设备本地开关在设置「外观」）。
  const { t } = useTranslation()
  const glow = useMotionPrefsStore((s) => s.glow)
  const aurora = useMotionPrefsStore((s) => s.aurora)
  const themeGlow = useMotionPrefsStore((s) => s.themeGlow)
  const themePreference = useSettingsStore((s) => s.theme)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const auroraRef = useRef<HTMLCanvasElement | null>(null)
  useAurora(auroraRef, aurora, resolveDark(themePreference))
  // 桌面右键上下文菜单（DESIGN.md §14）：仅空白画布（含壁纸层）。
  const [contextPos, setContextPos] = useState<ContextMenuPosition | null>(null)
  const onCanvasContextMenu = (event: ReactMouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (!(target === event.currentTarget || target.closest('[data-testid="wallpaper-layer"]'))) return
    event.preventDefault()
    setContextPos({ x: event.clientX, y: event.clientY })
  }
  const orbRef = useRef<HTMLDivElement | null>(null)
  useCursorGlow(canvasRef, orbRef, glow)
  useGlobalShortcuts()

  // 每个桌面会话自动打开一次动态面板：停靠桌面右上（避开左侧图标列），
  // 已打开则不重复；ref 挡掉 StrictMode 的双挂载。
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current) return
    autoOpened.current = true
    const { windows } = useWindowStore.getState()
    if (windows.some((win) => win.appId === AUTO_OPEN_APP_ID)) return
    const width = getAppManifest(AUTO_OPEN_APP_ID)?.window?.width ?? 680
    // 右侧小组件栏（§27）≥1280px 常驻：面板停靠让位。
    const railRight = window.innerWidth >= RAIL_RIGHT_BREAKPOINT_PX ? RAIL_RIGHT_WIDTH_PX : 0
    launchApp(
      AUTO_OPEN_APP_ID,
      {
        x: Math.max(8, window.innerWidth - railRight - width - 24),
        // 顶栏常驻（§19）：面板标题栏不得钻进菜单栏底下。
        y: MENUBAR_HEIGHT_PX + 24,
      },
      'system',
    )
  }, [])

  // 小游戏轮换（2026-09-26 用户裁决「每次进入桌面都是不一样的小游戏」）：
  // 在已安装的游戏里随机开一个（与上次不同）；没装游戏则静默跳过。
  const gameOpened = useRef(false)
  useEffect(() => {
    if (gameOpened.current) return
    gameOpened.current = true
    openRandomGame()
  }, [])

  return (
    <div
      ref={canvasRef}
      className="surface-canvas relative h-full overflow-hidden"
      onContextMenu={onCanvasContextMenu}
    >
      <WallpaperLayer />
      {/* 氛围层（DESIGN.md §18）：环境光 + 暗角，静态零动画，垫在光晕/图标/窗口之下。
          点击涟漪已于 2026-10-01 用户裁决移除（§15）。 */}
      <AtmosphereLayer />
      {/* 主题氛围光晕（§32.5 修订 10）：主题色大光斑呼吸，垫窗口/图标。 */}
      <div
        aria-hidden="true"
        data-testid="ambient-glow"
        className={`ambient-glow ${themeGlow ? 'is-on' : ''}`}
      />
      {/* 流光渐变氛围画布（§32.5 修订 10）：光斑合成层，淡入淡出由 CSS 消费。 */}
      <canvas
        aria-hidden="true"
        ref={auroraRef}
        data-testid="aurora-canvas"
        className="aurora-canvas pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      {/* 指针光晕层（默认关）：pointer-events-none，压壁纸、垫窗口与图标。 */}
      <div
        aria-hidden="true"
        ref={orbRef}
        data-testid="cursor-glow-orb"
        className="os-cursor-glow pointer-events-none absolute left-0 top-0 z-[5] opacity-0"
      />
      {/* 中央品牌层（§31 R2-2/§32 修订）：壁纸已换无文字原版画作，品牌字标
          恢复由 DOM 层承载（参考图位 44%/29%，窗口可见即淡出）。 */}
      <DesktopBranding />
      <h1 className="sr-only">{t('desktop.heading')}</h1>
      {/* DOM 序 = 视觉/Tab 序（UI 评审 P2-7）：菜单栏 → 左栏 → 窗口 → 右栏 →
          Dock。菜单栏 z-[41] 略高于其余 z-40 chrome，其下拉/通知面板不会被
          随后渲染的左右栏盖住（层级靠 z-index，不靠渲染顺序）。 */}
      <MenuBar />
      <Sidebar />
      <WindowLayer />
      <WidgetRail />
      <Taskbar />
      <NotificationToasts />
      <SearchPalette />
      <ContextMenu position={contextPos} onClose={() => setContextPos(null)} />
    </div>
  )
}
