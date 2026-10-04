/**
 * 中央品牌层可见性分级（Desktop Shell 3.0 STEP 5，纯函数）：
 * 「Desktop Environment Branding」四档——桌面状态 → opacity：
 * - hidden：任一 chrome 弹层打开（启动器/全局搜索/通知中心/菜单栏下拉/
 *   用户菜单/世界信号/右键菜单）→ 0%，品牌让位内容（§19 不挡应用零容忍）；
 * - full：空闲（无可见窗口）→ 100%，品牌的完整存在感；
 * - dim：单可见窗口 → 40%（30-50% 带内）：壁纸间隙仍见品牌轮廓，存在感
 *   让位唯一窗口；
 * - faint：多可见窗口 → 15%（0-20% 带内）：桌面已是工作台，品牌近乎退场。
 */
export type BrandingTier = 'full' | 'dim' | 'faint' | 'hidden'

export function brandingTier(visibleWindows: number, overlayOpen: boolean): BrandingTier {
  if (overlayOpen) return 'hidden'
  if (visibleWindows <= 0) return 'full'
  if (visibleWindows === 1) return 'dim'
  return 'faint'
}

/**
 * 档位 → opacity 工具类（整类名字面量供 Tailwind v4 源码扫描；档位值均在
 * STEP 5 契约带内：dim 30-50%、faint 0-20%、hidden=0、full=100%）。
 */
export const BRANDING_TIER_CLASS: Record<BrandingTier, string> = {
  full: 'opacity-100',
  dim: 'opacity-40',
  faint: 'opacity-15',
  hidden: 'opacity-0',
}
