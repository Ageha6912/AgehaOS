import { useRef } from 'react'

import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'
import { useMobileLauncherStore } from '@/store/mobile-launcher-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useMobileRecentsStore } from '@/store/mobile-recents-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useWindowStore } from '@/store/window-store'

import { MobileAppHost } from './app/MobileAppHost'
import { MobileHome } from './home/MobileHome'
import { useSwipeUp } from './gesture/use-swipe-up'
import { MobileRecentsSheet } from './recents/MobileRecentsSheet'
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
 *
 * 上滑唤起启动器（M3-1）：`mobile-dock-zone` 包裹层把 Dock 本体与 safe-area
 * 预留带收进同一个指针采集面，`useSwipeUp` 挂在包裹层上——底缘上滑（含
 * 甩动）打开 MobileLauncher。**刻意只挂 Dock 区、不挂全局**：内容区
 * （`.mobile-content-scroll`）的纵向原生滚动与该手势同为垂直方向，全局
 * 挂载只能在判定层猜「滚动还是唤起」，边界情形永远打架；Dock 与预留带均
 * 不可滚动，起于底缘带的上滑没有「本来想滚动」的解读——冲突在挂载点的
 * 空间隔离上消解（几何带判定是第二道门，两层都过才激活）。开关走
 * mobile-launcher-store（与网格搜索按钮同一开合出口，桌面 launcher-store
 * 多入口共享面板的同一模式）；确认回调 = `openLauncher`，Launcher 打开
 * 期间 enabled=false 手势不重复触发，应用视图（抽屉不挂载）同样不响应。
 * 跟手动画跟随 motion-prefs 转场档，reduced-motion 由 hook 落下时实时
 * 探测（降级直开，use-swipe-up.ts 模块注释）。
 *
 * 最近任务切换器（M3-2）：Bottom Sheet 覆盖层挂 Shell 根（fixed z-20，
 * Home 与应用视图之上——与状态栏两张 sheet 同层语义），开合归
 * mobile-recents-store；唯一入口 = Dock Home 位的长按/上滑（MobileDock
 * 内的手势 hook，Home 位 data-no-edge-back 让 M3-1 的 zone 级上滑在该
 * 起点让位）。关闭路径（backdrop/Esc/切卡/全部关闭后的空态兜底）回焦
 * Dock Home 位触发器——触发器与覆盖层分属两组件，经 testid 在本根作用
 * 域内定位回焦（桌面弹层关闭契约 §0.4 的移动口径）。
 */
export function MobileShell() {
  const nav = useMobileNavStore((state) => state.nav)
  const windowCount = useWindowStore((state) => state.windows.length)
  const launcherOpen = useMobileLauncherStore((state) => state.open)
  const openLauncher = useMobileLauncherStore((state) => state.openLauncher)
  const recentsOpen = useMobileRecentsStore((state) => state.open)
  const closeRecents = useMobileRecentsStore((state) => state.closeRecents)
  // 窗口切换转场档（motion-prefs）：关档 = 跟手/回弹全免，确认直开。
  const transitionsOn = useMotionPrefsStore((state) => state.windowTilt)

  // 最近任务关闭回焦触发器（Dock Home 位）：关闭路径统一经这里。
  const closeRecentsAndRefocus = (): void => {
    closeRecents()
    document.querySelector<HTMLButtonElement>('[data-testid="mobile-dock-home"]')?.focus()
  }

  // ── 上滑唤起启动器（M3-1）：挂在 Dock 区包裹层，home 且抽屉关闭时启用 ──
  const dockZoneRef = useRef<HTMLDivElement | null>(null)
  useSwipeUp({
    targetRef: dockZoneRef,
    enabled: nav.view === 'home' && !launcherOpen,
    followMotion: transitionsOn,
    onConfirm: openLauncher,
  })

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
        {/* 底部 Dock 区（M3-1 上滑手势挂载面）：Dock 本体（M1-5）+ safe-area
            预留带（M0-4）收进同一个指针采集面——上滑唤起启动器的触发区 =
            Dock 底缘 + 预留带（内容区纵向滚动与此手势空间隔离，见模块注释）。
            包裹层只是布局面（无角色，shrink-0 保三段骨架高度契约）；类名
            mobile-dock-zone 承接 index.css 的 touch-action: none（否则浏览器
            把底缘垂直拖拽认领给原生滚动尝试，pointer 中途被 pointercancel
            吃掉），Dock 与预留带的 testid/aria 契约原样保留。 */}
        <div ref={dockZoneRef} data-testid="mobile-dock-zone" className="mobile-dock-zone shrink-0">
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
        {/* M3-2 最近任务切换器：Bottom Sheet 覆盖层挂 Shell 根（Home 与
            应用视图之上）；开合归 mobile-recents-store，关闭回焦 Dock
            Home 位（见模块注释）。 */}
        <MobileRecentsSheet open={recentsOpen} onClose={closeRecentsAndRefocus} />
      </div>
    </div>
  )
}
