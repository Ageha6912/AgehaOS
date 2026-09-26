import { Taskbar } from '@/desktop/taskbar/Taskbar'
import { WindowLayer } from '@/desktop/window/WindowLayer'
import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { NotificationToasts } from '@/desktop/NotificationToasts'
import { SearchPalette } from '@/desktop/search/SearchPalette'
import { DesktopIcons } from '@/desktop/DesktopIcons'
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

export function Desktop() {
  // 动态桌面关闭（或尚无生成结果）时回落到系统画布渐变（docs/DESIGN.md §2.1，
  // 蓝白/藏蓝随主题；v0.1 的暖色硬编码渐变已随 2026-09 方向翻新退场）。
  const showWallpaper = useDynamicDesktopStore((s) => s.prefs.enabled && s.currentPlan !== null)
  useGlobalShortcuts()

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
