import { useTranslation } from '@/core/i18n'

import { useLauncherStore } from '@/store/launcher-store'
import { useNotificationStore } from '@/store/notification-store'
import { usePopoverStore } from '@/store/popover-store'
import { useSearchStore } from '@/store/search-store'
import { useWindowStore } from '@/store/window-store'

import { BRANDING_TIER_CLASS, brandingTier } from './branding-visibility'

/**
 * 桌面中央品牌层（Desktop Shell 3.0 STEP 5「Desktop Environment Branding」；
 * 位置/字号/渐变沿用 §31 Round 2 + §32 修订 7 基线不动）：从「Landing Page
 * Hero」退位为桌面环境品牌——属于桌面、不抢内容，opacity 由桌面状态分四档
 * 驱动（branding-visibility.ts 纯函数）：空闲 100%、单可见窗 40%、多可见窗
 * 15%，任一 chrome 弹层（启动器/全局搜索/通知中心 + popover 互斥槽兜住的
 * 菜单栏下拉/用户菜单/世界信号/右键菜单）打开即 0% 隐藏；过渡复用既有
 * transition-opacity（300ms ease-out），无第二套 motion。
 * Shell 3.1 STEP 4 精修（铭牌化）：容器双层蓝紫投影（0.6/0.35）减弱为单层
 * 低强度（0.35）——去「营销页悬浮光晕感」；分区留白 gap-4→gap-3 微收。
 * 四档机制/档位值/过渡参数零改动。
 * 性能契约（STEP 5 验收）：所有 store 订阅都取原始值选择器（zustand
 * Object.is 比较）——窗口 move/resize/focus 每次 commit 新数组引用但计数
 * 不变 → 零 re-render，重渲染只发生在档位真正变化时。
 * 纯装饰层：aria-hidden + pointer-events-none 恒成立（对辅助树与指针事件
 * 隐形，右键空白、壁纸点击等桌面契约不受影响），挂 .desktop-chrome 白字材质。
 */
export function DesktopBranding() {
  const { t } = useTranslation()
  // 可见窗口计数（非 minimized）。commit 新数组 → reduce 结果是同一个数 →
  // 不重渲染；开/关/最小化改变计数才重渲染。
  const visibleWindows = useWindowStore((s) =>
    s.windows.reduce((count, win) => (win.state === 'minimized' ? count : count + 1), 0),
  )
  const launcherOpen = useLauncherStore((s) => s.launcherOpen)
  const searchOpen = useSearchStore((s) => s.open)
  const panelOpen = useNotificationStore((s) => s.panelOpen)
  // 互斥槽兜住其余弹层；三大面板的直接开关与 claim（usePopoverDismiss 的
  // effect，晚一帧）并行订阅，保证打开当帧即进入隐藏档。
  const popoverActive = usePopoverStore((s) => s.active)
  const overlayOpen = launcherOpen || searchOpen || panelOpen || popoverActive !== null
  const tier = brandingTier(visibleWindows, overlayOpen)

  return (
    <div
      aria-hidden="true"
      data-testid="desktop-branding"
      className={`desktop-chrome pointer-events-none absolute left-1/2 top-[30%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 transition-opacity duration-300 ease-out [filter:drop-shadow(0_2px_10px_rgba(21,48,112,0.35))] ${BRANDING_TIER_CLASS[tier]}`}
    >
      {/* 字标豁免 chrome 级 text-shadow（阴影会透过 bg-clip-text 压暗渐变）；
          「OS」用 drop-shadow 做分离度（跟随裁剪后字形 alpha，不污染渐变填充）。
          §32 修订 7：字重/字号/纵向位置对齐用户指定样式——细字重 + 下移至
          壁纸蝴蝶同一高度（块中心 ≈ 30% y，随 2026-10-01 新原片蝴蝶位置更新）。 */}
      <p className="text-7xl font-light tracking-tight [text-shadow:none]">
        <span className="text-text [text-shadow:none]">Ageha</span>
        {/* 「OS」淡冰蓝→冷紫渐变（Shell 2.0 裁决 C：尾色 #f4bde4 粉 →
            #c4b5fd 冷紫 = Tailwind violet-300，去暖收冷）。 */}
        <span className="bg-gradient-to-r from-[#e6efff] via-[#e4dcff] to-[#d8ceff] bg-clip-text text-transparent [text-shadow:none] [filter:drop-shadow(0_1px_2px_rgb(40_40_110/55%))]">
          OS
        </span>
      </p>
      {/* 标语压在亮天空上：实色白字 + 双层暗晕（贴边 + 弥散）托底可读性。 */}
      <p className="text-xl tracking-wide text-text [text-shadow:0_1px_2px_rgb(15_30_70/55%),0_0_14px_rgb(15_30_70/35%)]">
        {t('desktop.brandTagline')}
      </p>
      <p className="text-[13px] font-medium text-text [text-shadow:0_1px_2px_rgb(15_30_70/60%),0_0_10px_rgb(15_30_70/35%)]">
        {t('desktop.brandTaglineSub')}
      </p>
      <div
        aria-hidden="true"
        className="mt-1 h-px w-28 bg-gradient-to-r from-transparent via-border-strong to-transparent"
      />
    </div>
  )
}
