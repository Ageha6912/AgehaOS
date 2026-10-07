import { useTranslation } from '@/core/i18n'

import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'

/**
 * 移动 Shell 根布局（M0-3 Mobile Root）：safe-area 生效的最小骨架。
 *
 * 结构（自上而下三段，均留空由 M1 填充）：
 * - 顶部状态栏占位区（`mobile-statusbar-slot`）：M1 填系统状态条；
 * - 内容区（`mobile-content-slot`）：M1 填 Home/应用视图（消费
 *   mobile-nav-store）；本切片暂驻 M0-2 的最小品牌字作占位；
 * - 底部 Dock 占位区（`mobile-dock-slot`）：M1 填 Dock。
 *
 * safe-area 契约（index.css 移动段）：`.mobile-shell` 根类声明
 * `--safe-top/right/bottom/left`（env(safe-area-inset-*)，无刘海视口回退
 * 0px，仅移动作用域、桌面零接触）；`.mobile-shell-frame` 内容列消费四变量
 * 做 padding，使三段骨架避开刘海与 Home 指示条。壁纸层（absolute inset-0）
 * 刻意挂在未加 padding 的 shell 根上——padding 盒会内缩 absolute 后代，
 * 壁纸必须全幅铺满不随安全区裁剪。
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
      {/* 根布局内容列：消费 --safe-* 做 padding（index.css 移动段）。 */}
      <div
        data-testid="mobile-shell-frame"
        className="mobile-shell-frame relative flex h-full w-full flex-col"
      >
        {/* 顶部状态栏占位区（M1 填充）。 */}
        <div data-testid="mobile-statusbar-slot" aria-hidden="true" className="shrink-0" />
        {/* 内容区（M1 填充 Home/应用视图）；中央品牌字为 M0-2 占位。sr-only
            地标对齐桌面 h1 契约（DESIGN.md §0.6）。 */}
        <div
          data-testid="mobile-content-slot"
          className="relative flex min-h-0 flex-1 items-center justify-center"
        >
          <h1 className="sr-only">{t('mobile.shell.heading')}</h1>
          <p
            data-testid="mobile-shell-brand"
            className="text-3xl font-light tracking-tight"
            style={{ color: 'var(--ag-text)' }}
          >
            {t('mobile.shell.brand')}
          </p>
        </div>
        {/* 底部 Dock 占位区（M1 填充）。 */}
        <div data-testid="mobile-dock-slot" aria-hidden="true" className="shrink-0" />
      </div>
    </div>
  )
}
