import { useRef, type HTMLAttributes, type ReactNode } from 'react'

import { useScrollZone } from './use-scroll-edge'

/**
 * 带底部渐隐遮罩的滚动列表（DESIGN.md §3）：常驻细滚动条
 * （`.scroll-thin`）+ 「有溢出且未到底」时在可视底缘渐隐，提示下方
 * 还有内容——解决悬浮式滚动条下「末行截断不可辨」的可用性问题。
 * ul 绝对铺满相对定位包装层，遮罩盖在可视区而非随内容滚动。
 */
export function ScrollFadeList({
  className,
  testId,
  children,
  ...ulProps
}: {
  className?: string
  testId?: string
  children: ReactNode
} & Omit<HTMLAttributes<HTMLUListElement>, 'className' | 'children'>) {
  const listRef = useRef<HTMLUListElement>(null)
  const zone = useScrollZone(listRef)

  return (
    <div className="relative min-h-0 flex-1">
      <ul
        ref={listRef}
        data-testid={testId}
        className={`scroll-thin absolute inset-0 overflow-y-auto ${className ?? ''}`}
        {...ulProps}
      >
        {children}
      </ul>
      {zone === 'more' && (
        <div
          aria-hidden="true"
          data-testid="scroll-fade"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-surface to-transparent"
        />
      )}
    </div>
  )
}
