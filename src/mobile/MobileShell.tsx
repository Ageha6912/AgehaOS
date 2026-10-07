import { useTranslation } from '@/core/i18n'

import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'

/**
 * 移动 Shell 根布局（M0-3 Mobile Root / M0-4 Safe Area）：safe-area 生效的
 * 最小骨架。
 *
 * 结构（自上而下三段，均留空由 M1 填充）：
 * - 顶部状态栏占位带（`mobile-statusbar-slot`）：高度
 *   max(env(safe-area-inset-top), 24px)——纯占位不显示假数据，M1 填系统
 *   状态条；
 * - 内容区（`mobile-content-slot`）：被两条占位带约束在安全区内，纵向
 *   超出走预留滚动容器（`mobile-content-scroll`，M1 填 Home/应用视图，
 *   消费 mobile-nav-store）；本切片暂驻 M0-2 的最小品牌字作占位；
 * - 底部 Dock 安全区预留带（`mobile-dock-slot`）：高度
 *   max(env(safe-area-inset-bottom), 12px)，给 Home indicator 留呼吸，
 *   M1 填 Dock。
 *
 * safe-area 契约（index.css 移动段）：`.mobile-shell` 根类声明
 * `--safe-top/right/bottom/left`（env(safe-area-inset-*)，无刘海视口回退
 * 0px，仅移动作用域、桌面零接触）；`.mobile-shell-frame` 内容列只消费
 * `--safe-left/right` 做左右横屏 padding（上/下由两条占位带承担，frame
 * 再加纵向 padding 会双重计入）。壁纸层（absolute inset-0）刻意挂在未加
 * padding 的 shell 根上——padding 盒会内缩 absolute 后代，壁纸必须全幅
 * 铺满不随安全区裁剪。视口需 `viewport-fit=cover`（index.html）env 才有
 * 非零值。视觉克制（M0-4）：两条占位带用 --ag-* 中性色
 * （var(--ag-surface)），不引入 blur。
 */
export function MobileShell() {
  const { t } = useTranslation()
  return (
    <div
      data-shell="mobile"
      data-testid="mobile-shell"
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
        {/* 顶部状态栏占位带（M0-4）：max(env(safe-area-inset-top), 24px)，
            纯占位不显示假数据；M1 填充。 */}
        <div
          data-testid="mobile-statusbar-slot"
          aria-hidden="true"
          className="mobile-statusbar-slot shrink-0"
        />
        {/* 内容区（M1 填充 Home/应用视图）：min-h-0 让占位带吃满剩余空间
            之外仍可收缩；滚动容器预留纵向滚动，中央品牌字为 M0-2 占位
            （min-h-full 包裹：内容超出时可生长，不截顶）。sr-only 地标
            对齐桌面 h1 契约（DESIGN.md §0.6）。 */}
        <div
          data-testid="mobile-content-slot"
          className="relative flex min-h-0 flex-1 flex-col"
        >
          <div
            data-testid="mobile-content-scroll"
            className="mobile-content-scroll relative flex-1"
          >
            <div className="flex min-h-full items-center justify-center">
              <h1 className="sr-only">{t('mobile.shell.heading')}</h1>
              <p
                data-testid="mobile-shell-brand"
                className="text-3xl font-light tracking-tight"
                style={{ color: 'var(--ag-text)' }}
              >
                {t('mobile.shell.brand')}
              </p>
            </div>
          </div>
        </div>
        {/* 底部 Dock 安全区预留带（M0-4）：max(env(safe-area-inset-bottom),
            12px) 给 Home indicator 留呼吸；M1 填充。 */}
        <div
          data-testid="mobile-dock-slot"
          aria-hidden="true"
          className="mobile-dock-slot shrink-0"
        />
      </div>
    </div>
  )
}
