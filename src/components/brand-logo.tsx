/**
 * AgehaOS 品牌 logo（docs/DESIGN.md §10）：用户提供的玻璃质感揚羽蝶主视觉。
 * 资产链：master 原图（`agehaos-logo-master.png`，1254²，永不动）→ 裁切
 * 方块本体（100,100,1054,1059）→ 各尺寸缩放稿。组件只做展示层贴合：
 * CSS 24% 圆角裁掉源图残余黑角，object-cover 保证任何比例下不变形。
 */
export const BRAND_LOGO_SRC = '/brand/agehaos-logo-256.png'

export function BrandLogo({
  size = 24,
  className,
  label,
}: {
  /** 边长（px），默认 24。 */
  size?: number
  className?: string
  /** 可访问名称；缺省时视为装饰（alt 空 + aria-hidden）。 */
  label?: string
}) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={`select-none rounded-[24%] object-cover${className ? ` ${className}` : ''}`}
    />
  )
}
