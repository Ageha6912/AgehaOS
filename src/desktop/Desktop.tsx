import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { useTranslation } from '@/core/i18n'
import { AtmosphereLayer } from '@/desktop/atmosphere/AtmosphereLayer'
import { DesktopBranding } from '@/desktop/branding/DesktopBranding'
import { MenuBar } from '@/desktop/menu-bar/MenuBar'
import { Sidebar } from '@/desktop/sidebar/Sidebar'
import { TodayRail } from '@/desktop/sidebar/TodayRail'
import { Taskbar } from '@/desktop/taskbar/Taskbar'
import { WindowLayer } from '@/desktop/window/WindowLayer'
import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { NotificationToasts } from '@/desktop/NotificationToasts'
import { SearchPalette } from '@/desktop/search/SearchPalette'
import { ContextMenu, type ContextMenuPosition } from '@/desktop/ContextMenu'
import { WidgetRail } from '@/desktop/widgets/WidgetRail'
import { useCursorGlow } from '@/desktop/motion/use-cursor-glow'
import { useAurora } from '@/desktop/motion/use-aurora'
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useSettingsStore, type ThemePreference } from '@/store/settings-store'

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

  // 2026-10-02 用户裁决：进桌面不再自动打开任何窗口——动态面板与随机小游戏
  // 的自动开窗整体退役（原 ADR 裁决 A5/A6 取代），桌面回归纯壁纸 + 品牌层；
  // 动态面板仍可经启动器/搜索手动打开，游戏仍可安装后手动启动。

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
      {/* 今日应用列（2026-10-03 用户裁决）：左栏右侧的整列今日应用，世界
          就绪才渲染。⚠️ 必须渲染在 Sidebar 之前（同 z-40 时后绘者在上）：
          左栏 tooltip 向右伸出要盖住今日列的玻璃（2026-10-03 实测：顺序
          反了会被右栏毛玻璃挡住）。 */}
      <TodayRail />
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
