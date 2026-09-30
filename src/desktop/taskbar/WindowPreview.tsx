import { X } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { useTranslation } from '@/core/i18n'
import type { WindowInstance } from '@/core/window/types'

/**
 * Dock 悬停预览（Windows 风格）：标题栏（图标 + 标题 + 关闭）+ 预览体。
 * 点击预览体切换到该窗口（最小化则还原）；关闭按钮直接关窗。
 *
 * 定位用 fixed：父链上有 overflow-x-auto 的滚动容器，absolute 预览会被裁剪；
 * footer（常驻 transform）是 fixed 的包含块且横贯视口底部，因此
 * bottom-full + mb-2 恰好悬在胶囊 Dock 上方（§20），left 由调用方按图标
 * 位置钳制后传入。预览体是风格化示意（应用图标水印 + 窗口状态）——DOM
 * 无法廉价地同屏二次呈现活动窗口内容，真实缩略截图属后续增强。
 */
export function WindowPreview({
  win,
  anchorLeft,
  onSwitch,
  onClose,
}: {
  win: WindowInstance
  /** 任务栏图标的视口 left 坐标（调用方在悬停时测量）。 */
  anchorLeft: number
  onSwitch: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const minimized = win.state === 'minimized'
  const left = Math.max(8, Math.min(anchorLeft, window.innerWidth - 272))

  return (
    <div
      data-testid="window-preview"
      style={{ left }}
      className="popover-panel surface-glass animate-os-pop-in fixed bottom-full z-50 mb-2 w-64 p-2"
      onClick={(event) => {
        event.stopPropagation()
        onSwitch()
      }}
    >
      <div className="flex items-center gap-2 pb-2">
        <AppIcon appId={win.appId} size={20} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{win.title}</span>
        <button
          type="button"
          aria-label={t('window.close')}
          data-testid="preview-close"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <X size={12} weight="regular" />
        </button>
      </div>

      <div className="flex h-36 items-center justify-center rounded-md border border-border bg-surface-raised/60">
        {minimized ? (
          <p className="text-xs text-text-muted">{t('taskbar.preview.minimized')}</p>
        ) : (
          <AppIcon appId={win.appId} size={48} className="opacity-40" />
        )}
      </div>
    </div>
  )
}
