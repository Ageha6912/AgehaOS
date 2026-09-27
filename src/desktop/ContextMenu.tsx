import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Gear, Sparkle, Storefront } from '@phosphor-icons/react'

import { launchApp } from '@/apps/launch'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { useTranslation } from '@/core/i18n'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'

/**
 * 桌面右键上下文菜单（PRD §7 桌面交互补全；motion-lab menu-toast §8.4 遗留项，
 * docs/DESIGN.md §14）：桌面空白处右键弹出，指针位置 + 视口边缘收拢（8px
 * 防裁切），动效复用 §14 语言（淡入 + 上浮，120ms 退场，重开中断续动）。
 * 关闭语义：点菜单项 / Esc / 菜单外按下 / 视口尺寸变化。
 */

export interface ContextMenuPosition {
  x: number
  y: number
}

/** 菜单贴视口边缘的最小留白 px（motion-lab menuEdgeGapPx 归档）。 */
const EDGE_GAP_PX = 8

export function ContextMenu({
  position,
  onClose,
}: {
  position: ContextMenuPosition | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const open = position !== null
  const phase = useExitPhase(open)
  const menuRef = useRef<HTMLMenuElement | null>(null)
  const [adjusted, setAdjusted] = useState<ContextMenuPosition | null>(position)
  // 记住最后一次打开位置（渲染期派生，React 官方模式——禁渲染期读 ref）：
  // 退场期间保持在原位（不跟随 null 抖动）。
  const [lastRaw, setLastRaw] = useState<ContextMenuPosition | null>(position)
  if (position !== null && position !== lastRaw) {
    setLastRaw(position)
  }
  const raw = phase.render ? lastRaw : null

  // 视口收拢：渲染后实测菜单尺寸，把位置钳进视口（pre-paint，无闪烁）。
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!raw || !menu) return
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    setAdjusted({
      x: Math.min(Math.max(raw.x, EDGE_GAP_PX), Math.max(EDGE_GAP_PX, window.innerWidth - width - EDGE_GAP_PX)),
      y: Math.min(Math.max(raw.y, EDGE_GAP_PX), Math.max(EDGE_GAP_PX, window.innerHeight - height - EDGE_GAP_PX)),
    })
  }, [raw])

  // 关闭语义：菜单外按下 / Esc / 视口尺寸变化。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onResize = (): void => onClose()
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onClose])

  if (!phase.render || !raw) return null

  const run = (action: () => void): void => {
    action()
    onClose()
  }

  const x = adjusted?.x ?? raw.x
  const y = adjusted?.y ?? raw.y

  return (
    <menu
      ref={menuRef}
      aria-label={t('contextmenu.label')}
      data-testid="context-menu"
      className={`surface-glass fixed z-50 w-48 rounded-lg border border-border p-1.5 shadow-window ${popoverMotionClass(phase.exiting)}`}
      style={{ left: x, top: y }}
    >
      <li>
        <button
          type="button"
          role="menuitem"
          data-testid="context-menu-renew-wallpaper"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
          onClick={() => run(() => systemDynamicDesktop.refresh())}
        >
          <Sparkle size={14} weight="regular" aria-hidden="true" />
          {t('contextmenu.renewWallpaper')}
        </button>
      </li>
      <li>
        <button
          type="button"
          role="menuitem"
          data-testid="context-menu-open-store"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
          onClick={() => run(() => launchApp('com.ageha.store'))}
        >
          <Storefront size={14} weight="regular" aria-hidden="true" />
          {t('contextmenu.openStore')}
        </button>
      </li>
      <li>
        <button
          type="button"
          role="menuitem"
          data-testid="context-menu-open-settings"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
          onClick={() => run(() => launchApp('com.ageha.settings'))}
        >
          <Gear size={14} weight="regular" aria-hidden="true" />
          {t('contextmenu.openSettings')}
        </button>
      </li>
    </menu>
  )
}
