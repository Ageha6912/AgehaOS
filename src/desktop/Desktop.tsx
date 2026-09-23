import { Taskbar } from '@/desktop/taskbar/Taskbar'
import { WindowLayer } from '@/desktop/window/WindowLayer'
import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { NotificationToasts } from '@/desktop/NotificationToasts'
import { SearchPalette } from '@/desktop/search/SearchPalette'
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

export function Desktop() {
  // 动态桌面关闭（或尚无生成结果）时保持 v0.1 的桌面外观与行为完全一致（设计文档 §1.3 原则 4）。
  const showWallpaper = useDynamicDesktopStore((s) => s.prefs.enabled && s.currentPlan !== null)
  useGlobalShortcuts()

  return (
    <div className="relative h-full overflow-hidden bg-gradient-to-b from-[#292524] via-[#1c1917] to-[#0c0a09]">
      {showWallpaper && <WallpaperLayer />}
      <WindowLayer />
      <NotificationToasts />
      <Taskbar />
      <SearchPalette />
    </div>
  )
}
