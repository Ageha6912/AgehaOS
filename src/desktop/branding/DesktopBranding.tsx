import { useTranslation } from '@/core/i18n'

import { useWindowStore } from '@/store/window-store'

/**
 * 桌面中央品牌层（docs/DESIGN.md §31 Round 2，2026-10-01 用户重申参考图）：
 * 桌面空闲（无可见窗口）时展示 AgehaOS 品牌焦点——字标 + 标语 + 品牌辅线；
 * 任一窗口可见即淡出（§19：打开窗口后降低存在感，绝不挡应用）。
 * 纯装饰层：aria-hidden + pointer-events-none，对辅助树与指针事件隐形
 * （右键空白、壁纸点击等桌面契约不受影响），品牌字标用 Token 渐变不上图片。
 */
export function DesktopBranding() {
  const { t } = useTranslation()
  const windows = useWindowStore((s) => s.windows)
  const idle = windows.every((win) => win.state === 'minimized')

  return (
    <div
      aria-hidden="true"
      data-testid="desktop-branding"
      className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 pb-16 transition-opacity duration-300 ease-out ${
        idle ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <p className="bg-gradient-to-r from-text via-primary to-text bg-clip-text text-6xl font-semibold tracking-tight text-transparent">
        AgehaOS
      </p>
      <p className="text-sm text-text-muted">{t('desktop.brandTagline')}</p>
      <div aria-hidden="true" className="h-px w-16 bg-gradient-to-r from-transparent via-primary to-transparent" />
      <p className="text-xs text-text-tertiary">{t('desktop.brandTaglineSub')}</p>
    </div>
  )
}
