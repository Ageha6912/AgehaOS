import { useTranslation } from '@/core/i18n'

import { useWindowStore } from '@/store/window-store'

/**
 * 桌面中央品牌层（docs/DESIGN.md §31 Round 2 + §32 参考图对齐）：
 * 桌面空闲（无可见窗口）时展示 AgehaOS 品牌焦点——字标 + 标语 + 副标语 +
 * 分隔线，字号/字重/位置按参考图（块中心 ≈ 44% x / 29% y，字标 ≈ 72px，
 * 「OS」带淡粉紫渐变）；任一窗口可见即淡出（§19：绝不挡应用）。
 * 纯装饰层：aria-hidden + pointer-events-none，对辅助树与指针事件隐形
 * （右键空白、壁纸点击等桌面契约不受影响），挂 .desktop-chrome 白字材质。
 */
export function DesktopBranding() {
  const { t } = useTranslation()
  const windows = useWindowStore((s) => s.windows)
  const idle = windows.every((win) => win.state === 'minimized')

  return (
    <div
      aria-hidden="true"
      data-testid="desktop-branding"
      className={`desktop-chrome pointer-events-none absolute left-[44%] top-[30%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 transition-opacity duration-300 ease-out [filter:drop-shadow(0_1px_3px_rgba(21,48,112,0.6))_drop-shadow(0_4px_18px_rgba(21,48,112,0.35))] ${
        idle ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* 字标豁免 chrome 级 text-shadow（阴影会透过 bg-clip-text 压暗渐变）；
          「OS」用 drop-shadow 做分离度（跟随裁剪后字形 alpha，不污染渐变填充）。
          §32 修订 7：字重/字号/纵向位置对齐用户指定样式——细字重 + 下移至
          壁纸蝴蝶同一高度（块中心 ≈ 30% y，随 2026-10-01 新原片蝴蝶位置更新）。 */}
      <p className="text-7xl font-light tracking-tight [text-shadow:none]">
        <span className="text-text [text-shadow:none]">Ageha</span>
        {/* 「OS」淡冰蓝→粉渐变（参考图取色）。 */}
        <span className="bg-gradient-to-r from-[#cfe0ff] via-[#dcd0ff] to-[#f4bde4] bg-clip-text text-transparent [text-shadow:none] [filter:drop-shadow(0_1px_2px_rgb(70_60_130/38%))]">
          OS
        </span>
      </p>
      <p className="text-xl font-light tracking-wide text-text">
        {t('desktop.brandTagline')}
      </p>
      <p className="text-[13px] text-text-muted">{t('desktop.brandTaglineSub')}</p>
      <div
        aria-hidden="true"
        className="mt-1 h-px w-28 bg-gradient-to-r from-transparent via-border-strong to-transparent"
      />
    </div>
  )
}
