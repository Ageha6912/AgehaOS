import { useId } from 'react'

/**
 * AgehaOS 品牌标（docs/DESIGN.md §10）：几何化揚羽蝶——钴蓝渐变圆角底 +
 * 白色棱角蝶形，与应用徽章同族几何（24% 圆角、150° 渐变）。
 * 「Ageha（揚羽）」即凤蝶：系统名、图标、品牌三者一体。
 * 系统界面中的 🦋 emoji 自此退位（2026-09-26 品牌标裁决）。
 */
export function AgehaMark({
  size = 24,
  className,
  label,
}: {
  /** 边长（px），默认 24。 */
  size?: number
  className?: string
  /** 可访问名称；缺省时视为装饰（aria-hidden）。 */
  label?: string
}) {
  const gradientId = useId()
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f7cf9" />
          <stop offset="1" stopColor="#1d43b8" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="15.4" fill={`url(#${gradientId})`} />
      <g fill="#ffffff">
        <polygon points="34,26 56,8 60,20 58,28 36,33" />
        <polygon points="30,26 8,8 4,20 6,28 28,33" />
        <polygon points="34,35 55,42 57,55 44,51 33,42" opacity="0.85" />
        <polygon points="30,35 9,42 7,55 20,51 31,42" opacity="0.85" />
        <rect x="30.75" y="20" width="2.5" height="28" rx="1.25" />
      </g>
      <g stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M 31.5 20 L 27 11" />
        <path d="M 32.5 20 L 37 11" />
      </g>
    </svg>
  )
}
