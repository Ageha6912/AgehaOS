import { useEffect, useRef } from 'react'

import { launchApp } from '@/apps/launch'
import { Taskbar } from '@/desktop/taskbar/Taskbar'
import { WindowLayer } from '@/desktop/window/WindowLayer'
import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { NotificationToasts } from '@/desktop/NotificationToasts'
import { SearchPalette } from '@/desktop/search/SearchPalette'
import { DesktopIcons } from '@/desktop/DesktopIcons'
import { openRandomGame } from '@/desktop/game-rotation'
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { getAppManifest } from '@/store/app-store'
import { useWindowStore } from '@/store/window-store'

/** 动态面板默认开启（2026-09-26 用户裁决）：进入桌面自动打开的仪表盘。 */
const AUTO_OPEN_APP_ID = 'com.ageha.dynamic.panel'

export function Desktop() {
  // 动态桌面关闭（或尚无生成结果）时回落到系统画布渐变（docs/DESIGN.md §2.1，
  // 蓝白/藏蓝随主题；v0.1 的暖色硬编码渐变已随 2026-09 方向翻新退场）。
  const showWallpaper = useDynamicDesktopStore((s) => s.prefs.enabled && s.currentPlan !== null)
  useGlobalShortcuts()

  // 每个桌面会话自动打开一次动态面板：停靠桌面右上（避开左侧图标列），
  // 已打开则不重复；ref 挡掉 StrictMode 的双挂载。
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current) return
    autoOpened.current = true
    const { windows } = useWindowStore.getState()
    if (windows.some((win) => win.appId === AUTO_OPEN_APP_ID)) return
    const width = getAppManifest(AUTO_OPEN_APP_ID)?.window?.width ?? 360
    launchApp(AUTO_OPEN_APP_ID, {
      x: Math.max(8, window.innerWidth - width - 24),
      y: 24,
    })
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
    <div className="surface-canvas relative h-full overflow-hidden">
      {showWallpaper && <WallpaperLayer />}
      <DesktopIcons />
      <WindowLayer />
      <NotificationToasts />
      <Taskbar />
      <SearchPalette />
    </div>
  )
}
