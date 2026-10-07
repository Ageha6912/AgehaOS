import { useTranslation } from '@/core/i18n'

import { WallpaperLayer } from '@/desktop/wallpaper/WallpaperLayer'

/**
 * 移动 Shell 根占位（M0-2 Shell Selection）：`device-store` 判为 mobile
 * （手机与平板，2026-10-07 裁决：tablet 同壳、网格后续自适应）时 ready
 * 分支的根组件。本切片只交付骨架——全屏容器 + `data-shell="mobile"` 根
 * 标记 + `--ag-*` Token 中性底色 + 壁纸底（复用桌面 WallpaperLayer，竖屏
 * 裁剪 M1 再做）+ 中央最小品牌字；Home 内容归 M1。
 */
export function MobileShell() {
  const { t } = useTranslation()
  return (
    <div
      data-shell="mobile"
      data-testid="mobile-shell"
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: 'var(--ag-surface)' }}
    >
      {/* 壁纸底：与桌面同一 WallpaperLayer（照片基底出厂默认，field 覆盖层
          由层内按动态桌面状态渲染）；竖屏裁剪与移动构图归 M1。 */}
      <WallpaperLayer />
      {/* 中央最小品牌字（i18n）；sr-only 地标对齐桌面 h1 契约（DESIGN.md §0.6）。 */}
      <div className="absolute inset-0 flex items-center justify-center">
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
  )
}
