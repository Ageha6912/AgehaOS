import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { launchApp } from '@/apps/launch'
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
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { getAppManifest } from '@/store/app-store'
import { useWindowStore } from '@/store/window-store'

/** 动态面板默认开启（2026-09-26 用户裁决）：进入桌面自动打开的仪表盘。 */
const AUTO_OPEN_APP_ID = 'com.ageha.dynamic.panel'

export function Desktop() {
  // 动态桌面关闭（或尚无生成结果）时回落到系统画布渐变（docs/DESIGN.md §2.1，
  // 蓝白/藏蓝随主题；v0.1 的暖色硬编码渐变已随 2026-09 方向翻新退场）。
  const showWallpaper = useDynamicDesktopStore((s) => s.prefs.enabled && s.currentPlan !== null)
  // 桌面增强动效（DESIGN.md §15）：可选指针光晕（默认关）。
  const glow = useMotionPrefsStore((s) => s.glow)
  const canvasRef = useRef<HTMLDivElement | null>(null)
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
      {showWallpaper && <WallpaperLayer />}
      {/* 氛围层（DESIGN.md §18）：环境光 + 暗角，静态零动画，垫在光晕/图标/窗口之下。
          点击涟漪已于 2026-10-01 用户裁决移除（§15）。 */}
      <AtmosphereLayer />
      {/* 指针光晕层（默认关）：pointer-events-none，压壁纸、垫窗口与图标。 */}
      <div
        aria-hidden="true"
        ref={orbRef}
        data-testid="cursor-glow-orb"
        className="os-cursor-glow pointer-events-none absolute left-0 top-0 z-[5] opacity-0"
      />
      {/* 中央品牌层（§31 Round 2）：桌面空闲时的品牌焦点，窗口可见即淡出；
          aria-hidden + pointer-events-none，不参与辅助树与指针契约。 */}
      <DesktopBranding />
      <WindowLayer />
      <NotificationToasts />
      {/* 轨道栏（§26/§27）先于顶栏/Dock 渲染：同为 z-40 chrome，DOM 序靠前者
          垫底——顶栏右挂面板（用户菜单/通知中心）与 Dock 浮层必须能点到。 */}
      <Sidebar />
      <WidgetRail />
      {/* 顶部菜单栏（§19）：常驻 chrome，z-40 与任务栏同级；通知/用户/时钟挂此。 */}
      <MenuBar />
      <Taskbar />
      <SearchPalette />
      <ContextMenu position={contextPos} onClose={() => setContextPos(null)} />
    </div>
  )
}
