import type { CSSProperties } from 'react'

import { badgeForAppIdWithHue } from './app-badges'

/**
 * 应用徽章图标（docs/DESIGN.md §8）：AppIcon 渲染圆角徽章——
 * 冷色系双色渐变底 + 白色填充字形，几何与投影完全统一。
 * 精选应用走手工配色，其余应用按 appId 确定性生成（同 id 恒同徽章）。
 * 尺寸约定：搜索 16 / 窗口标题栏 16 / 任务栏 20 / 悬停预览 20·48 / 开始菜单 24 / 桌面 40。
 */
const TILE_CLASS =
  'inline-flex shrink-0 select-none items-center justify-center rounded-[24%] ' +
  'ring-1 ring-inset ring-white/25 shadow-[0_1px_2px_rgba(15,23,42,0.25)]'

export interface AppIconProps {
  appId: string
  /** 徽章边长（px），默认 24。 */
  size?: number
  /** 可访问名称；缺省时徽章视为装饰（aria-hidden）。 */
  label?: string
  /** 世界行色相着色（§6.4 今日应用）：只旋转渐变色相，缺省确定性徽章。 */
  hue?: number
  className?: string
}

export function AppIcon({ appId, size = 24, label, hue, className }: AppIconProps) {
  const badge = badgeForAppIdWithHue(appId, hue)
  const Glyph = badge.glyph
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `linear-gradient(150deg, ${badge.from}, ${badge.to})`,
  }
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`${TILE_CLASS}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <Glyph size={Math.round(size * 0.58)} weight="fill" color="#ffffff" />
    </span>
  )
}
