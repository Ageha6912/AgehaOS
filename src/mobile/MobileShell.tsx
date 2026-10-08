import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useWindowStore } from '@/store/window-store'

import { MobileAppHost } from './app/MobileAppHost'
import { MobileHome } from './home/MobileHome'
import { MobileStatusBar } from './statusbar/MobileStatusBar'
import { MobileDock } from './dock/MobileDock'

/**
 * 移动 Shell 根布局（M0-3 骨架 / M0-4 Safe Area / M1-1 StatusBar+Home /
 * M1-5 Dock）。
 *
 * 结构（自上而下三段）：
 * - 顶部状态栏（`mobile-statusbar-slot`）：高度
 *   max(env(safe-area-inset-top), 24px)，M1-1 起由 MobileStatusBar 填充
 *   （时钟/电池/网络/用户，真实数据源，能力不可用即隐藏）；
 * - 内容区（`mobile-content-slot`）：被两条占位带约束在安全区内，纵向
 *   超出走预留滚动容器（`mobile-content-scroll`）；Home 视图（品牌头 +
 *   时段问候，消费 session-store）挂这里，应用视图归 M1-6 AppHost；
 * - 底部 Dock（M1-5）：玻璃白名单五处之一的 Dock 位（DESIGN.md §35.1，
 *   唯一玻璃层 = surface-glass 基底 + glass-raise），坐在 Dock 安全区预留带
 *   上方——固定 5 位（Home 复位 + Files/Notes/今日世界/Settings openApp），
 *   应用元数据/图标/注册表/启动语义与桌面 Dock 同源（ARCHITECTURE.md
 *   §3.25 复用边界），UI 完全独立；
 * - 底部 Dock 安全区预留带（`mobile-dock-slot`）：高度
 *   max(env(safe-area-inset-bottom), 12px)，M0-4 契约不变——纯占位空带给
 *   Home indicator 留呼吸，Dock 本体不进驻（带保持 aria-hidden）。
 *
 * safe-area 契约（index.css 移动段）：`.mobile-shell` 根类声明
 * `--safe-top/right/bottom/left`（env(safe-area-inset-*)，无刘海视口回退
 * 0px，仅移动作用域、桌面零接触）；`.mobile-shell-frame` 内容列只消费
 * `--safe-left/right` 做左右横屏 padding（上/下由两条占位带承担，frame
 * 再加纵向 padding 会双重计入）。壁纸层（absolute inset-0）刻意挂在未加
 * padding 的 shell 根上——padding 盒会内缩 absolute 后代，壁纸必须全幅
 * 铺满不随安全区裁剪。视口需 `viewport-fit=cover`（index.html）env 才有
 * 非零值。视觉克制：两条占位带与状态条用 --ag-* 中性色实色底，不引入
 * blur（玻璃白名单见 DESIGN.md §35.1）。
 *
 * 导航反射：mobile-nav-store 的当前位置以 data-nav-view / data-nav-app-id
 * 标记在根元素上（与 data-shell 同一「标记供测试断言」先例）——M1-6 起内容
 * 区按 nav 分支渲染真实视图（home = MobileHome，app = MobileAppHost 全屏
 * 应用宿主，见下），反射语义由视图分支自然承接；data-window-count 反射
 * window-store 窗口总数，供 E2E 断言「视图推进与窗口生命周期同步」（同一
 * 断言口先例：桌面侧窗口状态经 WindowFrame DOM 可见，移动窗口不渲染桌面
 * 容器，需要这条显式反射）。
 */
export function MobileShell() {
  const nav = useMobileNavStore((state) => state.nav)
  const windowCount = useWindowStore((state) => state.windows.length)

  return (
    <div
      data-shell="mobile"
      data-testid="mobile-shell"
      data-nav-view={nav.view}
      data-nav-app-id={nav.view === 'app' ? nav.appId : undefined}
      data-window-count={windowCount}
      className="mobile-shell relative h-full w-full overflow-hidden"
      style={{ backgroundColor: 'var(--ag-surface)' }}
    >
      {/* 壁纸底：与桌面同一 WallpaperLayer，全幅铺满（见模块注释 safe-area
          契约段）；竖屏裁剪与移动构图归 M1。 */}
      <WallpaperLayer />
      {/* 根布局内容列：只消费 --safe-left/right 做左右 padding（index.css
          移动段）；上/下安全区由两条占位带承担。 */}
      <div
        data-testid="mobile-shell-frame"
        className="mobile-shell-frame relative flex h-full w-full flex-col"
      >
        {/* 顶部状态栏（M1-1）：占位带高度契约不变（max(env top, 24px)），
            内部由 MobileStatusBar 填充真实状态读出。 */}
        <div
          data-testid="mobile-statusbar-slot"
          className="mobile-statusbar-slot shrink-0"
        >
          <MobileStatusBar />
        </div>
        {/* 内容区：min-h-0 让占位带吃满剩余空间之外仍可收缩；滚动容器按
            nav 分支承载 Home（M1-1）与全屏应用宿主（M1-6，面板 absolute
            inset-0 盖满滚动容器，自带 header + 内容滚动面）。sr-only 地标
            对齐桌面 h1 契约（DESIGN.md §0.6，随 MobileHome 挂载）。 */}
        <div
          data-testid="mobile-content-slot"
          className="relative flex min-h-0 flex-1 flex-col"
        >
          <div
            data-testid="mobile-content-scroll"
            className="mobile-content-scroll relative flex-1"
          >
            {nav.view === 'home' && (
              <div className="flex min-h-full flex-col">
                <MobileHome />
              </div>
            )}
            <MobileAppHost />
          </div>
        </div>
        {/* 底部 Dock（M1-5）：坐在 Dock 安全区预留带上方（HANDOFF §4.0-6），
            safe-area bottom 高度仍由下方预留带承担，本组件零 env 消费。 */}
        <MobileDock />
        {/* 底部 Dock 安全区预留带（M0-4）：max(env(safe-area-inset-bottom),
            12px) 给 Home indicator 留呼吸；纯占位空带保持 aria-hidden，
            Dock 本体在带上方。 */}
        <div
          data-testid="mobile-dock-slot"
          aria-hidden="true"
          className="mobile-dock-slot shrink-0"
        />
      </div>
    </div>
  )
}
