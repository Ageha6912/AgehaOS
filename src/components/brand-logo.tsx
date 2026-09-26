/**
 * AgehaOS 品牌 logo（docs/DESIGN.md §10）：用户提供的玻璃质感揚羽蝶主视觉。
 * 资产链：v2 母版（`agehaos-logo-v2-master.png`，1254²，黑底揚羽蝶+字标，永不动）
 * → 黑底转透明（边界泛洪）→ 纯图形方形稿（mark，无字标，小尺寸清晰）。组件只做展示层贴合：
 * mark 稿 CSS 24% 圆角裁掉源图残余黑角，object-cover 保证任何比例下不变形。
 */
export const BRAND_LOGO_SRC = '/brand/agehaos-logo-v2-mark-256.png'

/**
 * 含字标的全尺寸版（DESIGN.md §10 双资产分工）：只给开机动画等大尺寸位，
 * 小尺寸（18px 级）下字标不可辨，一律用 mark。
 */
export const BRAND_LOGO_FULL_SRC = '/brand/agehaos-logo-v2-full-512.png'

export function BrandLogo({
  size = 24,
  className,
  label,
  variant = 'mark',
}: {
  /** 边长（px），默认 24。 */
  size?: number
  className?: string
  /** 可访问名称；缺省时视为装饰（alt 空 + aria-hidden）。 */
  label?: string
  /** mark=纯图形方形稿（默认，界面小尺寸）；full=含字标（开机屏等大尺寸位）。 */
  variant?: 'mark' | 'full'
}) {
  const full = variant === 'full'
  return (
    <img
      src={full ? BRAND_LOGO_FULL_SRC : BRAND_LOGO_SRC}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={`select-none object-cover${full ? '' : ' rounded-[24%]'}${className ? ` ${className}` : ''}`}
    />
  )
}
