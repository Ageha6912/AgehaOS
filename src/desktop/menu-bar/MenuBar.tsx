import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

import { Check } from '@phosphor-icons/react'

import { launchApp } from '@/apps/launch'
import { BrandLogo } from '@/components/brand-logo'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { useTranslation } from '@/core/i18n'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import { NotificationCenter } from '@/desktop/taskbar/NotificationCenter'
import { useClock } from '@/desktop/taskbar/use-clock'
import { UserMenu } from '@/desktop/taskbar/UserMenu'
import { useSearchStore } from '@/store/search-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'

type MenuId = 'file' | 'view' | 'window' | 'help'

/** 触发器顺序（键盘左右遍历的环）。 */
const MENU_IDS: MenuId[] = ['file', 'view', 'window', 'help']

/**
 * 顶部菜单栏（docs/DESIGN.md §19，升级提示词 §15）：左 = 品牌 + 菜单，
 * 右 = 系统状态（通知/用户/时钟——2026-09-30 Q3 裁决自任务栏迁移）。
 * 只放有真实动作的菜单项（「编辑」无真实目标，缓办）；键盘走 Tab/Enter/
 * Esc（箭头遍历留后续），关闭语义与右键菜单一致（项点击/Esc/外部按下）。
 */
export function MenuBar() {
  const { t } = useTranslation()
  const clock = useClock()
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)

  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const windows = useWindowStore((s) => s.windows)
  const focus = useWindowStore((s) => s.focus)
  const restore = useWindowStore((s) => s.restore)
  const minimize = useWindowStore((s) => s.minimize)
  const closeWindow = useWindowStore((s) => s.close)

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [openMenu])

  const close = (): void => setOpenMenu(null)
  const act = (run: () => void): void => {
    close()
    run()
  }

  // —— 键盘模型（§19 P2-4）：触发器左右切换、菜单内上下循环/左右换菜单、
  // Esc 回焦触发器、Home/End 首末项。焦点用真实 DOM focus（Tab 语义不变）。 ——
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({})
  const dropdownRefs = useRef<Partial<Record<MenuId, HTMLDivElement | null>>>({})
  const [pendingItemFocus, setPendingItemFocus] = useState<{
    id: MenuId
    delta: 1 | -1
  } | null>(null)

  const enabledItems = (id: MenuId): HTMLButtonElement[] => {
    const dropdown = dropdownRefs.current[id]
    if (!dropdown) return []
    return Array.from(
      dropdown.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    )
  }
  const stepMenuItem = (id: MenuId, delta: 1 | -1): void => {
    const items = enabledItems(id)
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      index === -1
        ? delta === 1
          ? 0
          : items.length - 1
        : (index + delta + items.length) % items.length
    items[next]?.focus()
  }

  useEffect(() => {
    if (!pendingItemFocus) return
    stepMenuItem(pendingItemFocus.id, pendingItemFocus.delta)
    setPendingItemFocus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItemFocus])

  const focusTrigger = (id: MenuId, open: boolean): void => {
    if (open) setOpenMenu(id)
    triggerRefs.current[id]?.focus()
  }
  const stepTrigger = (id: MenuId, delta: 1 | -1): void => {
    const index = MENU_IDS.indexOf(id)
    const next = MENU_IDS[(index + delta + MENU_IDS.length) % MENU_IDS.length]
    focusTrigger(next, openMenu !== null)
  }
  const closeAndRefocus = (id: MenuId): void => {
    setOpenMenu(null)
    triggerRefs.current[id]?.focus()
  }

  const onTriggerKeyDown = (id: MenuId) => (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      stepTrigger(id, event.key === 'ArrowRight' ? 1 : -1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpenMenu(id)
      setPendingItemFocus({ id, delta: event.key === 'ArrowDown' ? 1 : -1 })
    }
  }
  const onDropdownKeyDown = (id: MenuId) => (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      stepMenuItem(id, event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      stepTrigger(id, event.key === 'ArrowRight' ? 1 : -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const items = enabledItems(id)
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeAndRefocus(id)
    }
  }

  return (
    <header
      ref={rootRef}
      data-testid="menu-bar"
      className="surface-glass fixed inset-x-0 top-0 z-40 flex h-[var(--ag-menubar-height)] items-center gap-1 border-b border-border-subtle px-2 shadow-soft"
    >
      <div className="flex items-center gap-1.5 pr-1">
        <BrandLogo size={16} />
        <span className="hidden text-xs font-semibold text-text sm:inline">{t('menubar.brand')}</span>
      </div>

      {/* 窄屏（<640px）收起菜单标签，只留品牌 + 系统状态（§25）。 */}
      <nav className="hidden items-center gap-1 sm:flex">
      <MenuEntry
        label={t('menubar.file')}
        open={openMenu === 'file'}
        onToggle={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
        onHoverSwitch={() => openMenu !== null && setOpenMenu('file')}
        onTriggerKeyDown={onTriggerKeyDown('file')}
        onDropdownKeyDown={onDropdownKeyDown('file')}
        triggerRef={(element) => {
          triggerRefs.current['file'] = element
        }}
        dropdownRef={(element) => {
          dropdownRefs.current['file'] = element
        }}
      >
        <MenuItem label={t('menubar.file.files')} onSelect={() => act(() => launchApp('com.ageha.files'))} />
        <MenuItem
          label={t('menubar.file.search')}
          onSelect={() => act(() => useSearchStore.getState().setOpen(true))}
        />
      </MenuEntry>

      <MenuEntry
        label={t('menubar.view')}
        open={openMenu === 'view'}
        onToggle={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
        onHoverSwitch={() => openMenu !== null && setOpenMenu('view')}
        onTriggerKeyDown={onTriggerKeyDown('view')}
        onDropdownKeyDown={onDropdownKeyDown('view')}
        triggerRef={(element) => {
          triggerRefs.current['view'] = element
        }}
        dropdownRef={(element) => {
          dropdownRefs.current['view'] = element
        }}
      >
        <MenuItem
          label={t('contextmenu.renewWallpaper')}
          onSelect={() => act(() => void systemDynamicDesktop.refresh())}
        />
        <MenuSeparator />
        <MenuItem
          label={t('theme.light')}
          checked={theme === 'light'}
          onSelect={() => act(() => setTheme('light'))}
        />
        <MenuItem
          label={t('theme.dark')}
          checked={theme === 'dark'}
          onSelect={() => act(() => setTheme('dark'))}
        />
        <MenuItem
          label={t('theme.system')}
          checked={theme === 'system'}
          onSelect={() => act(() => setTheme('system'))}
        />
      </MenuEntry>

      <MenuEntry
        label={t('menubar.window')}
        open={openMenu === 'window'}
        onToggle={() => setOpenMenu(openMenu === 'window' ? null : 'window')}
        onHoverSwitch={() => openMenu !== null && setOpenMenu('window')}
        onTriggerKeyDown={onTriggerKeyDown('window')}
        onDropdownKeyDown={onDropdownKeyDown('window')}
        triggerRef={(element) => {
          triggerRefs.current['window'] = element
        }}
        dropdownRef={(element) => {
          dropdownRefs.current['window'] = element
        }}
      >
        <MenuItem
          label={t('menubar.window.minimizeAll')}
          disabled={windows.length === 0}
          onSelect={() =>
            act(() => {
              for (const win of [...windows]) {
                if (win.state !== 'minimized') minimize(win.id)
              }
            })
          }
        />
        <MenuItem
          label={t('menubar.window.closeAll')}
          disabled={windows.length === 0}
          onSelect={() =>
            act(() => {
              for (const win of [...windows]) closeWindow(win.id)
            })
          }
        />
        {windows.length > 0 && <MenuSeparator />}
        {windows.map((win) => (
          <MenuItem
            key={win.id}
            label={win.title}
            checked={win.focused && win.state !== 'minimized'}
            onSelect={() => act(() => (win.state === 'minimized' ? restore(win.id) : focus(win.id)))}
          />
        ))}
      </MenuEntry>

      <MenuEntry
        label={t('menubar.help')}
        open={openMenu === 'help'}
        onToggle={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
        onHoverSwitch={() => openMenu !== null && setOpenMenu('help')}
        onTriggerKeyDown={onTriggerKeyDown('help')}
        onDropdownKeyDown={onDropdownKeyDown('help')}
        triggerRef={(element) => {
          triggerRefs.current['help'] = element
        }}
        dropdownRef={(element) => {
          dropdownRefs.current['help'] = element
        }}
      >
        <MenuItem
          label={t('menubar.help.about')}
          onSelect={() => act(() => launchApp('com.ageha.settings'))}
        />
      </MenuEntry>

      </nav>

      {/* 系统状态区（Q3 裁决自任务栏迁移）：通知中心 + 用户菜单 + 时钟。 */}
      <div className="ml-auto flex items-center gap-0.5">
        <NotificationCenter />
        <UserMenu />
        <time data-testid="menu-bar-clock" className="shrink-0 px-2 text-xs text-text-muted">
          {clock}
        </time>
      </div>
    </header>
  )
}

/** 菜单项（role=menuitem）：勾选位对齐（无勾选时占位），禁用态半透明。 */
function MenuItem({
  label,
  checked,
  disabled,
  onSelect,
}: {
  label: string
  checked?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text hover:bg-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={onSelect}
    >
      <span
        aria-hidden="true"
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-primary"
      >
        {checked ? <Check size={12} weight="bold" /> : null}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

function MenuSeparator() {
  return <div aria-hidden="true" className="my-1 h-px bg-border-subtle" />
}

/** 菜单触发器 + 下拉容器；下拉复用 §14 弹层动效（进 200ms / 退 120ms）。 */
function MenuEntry({
  label,
  open,
  onToggle,
  onHoverSwitch,
  onTriggerKeyDown,
  onDropdownKeyDown,
  triggerRef,
  dropdownRef,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  onHoverSwitch: () => void
  onTriggerKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  onDropdownKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  triggerRef: (element: HTMLButtonElement | null) => void
  dropdownRef: (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  return (
    <div className="relative flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={triggerRef}
        className="flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-text-muted hover:bg-surface-raised hover:text-text aria-expanded:bg-surface-raised aria-expanded:text-text"
        onClick={onToggle}
        onPointerEnter={onHoverSwitch}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      <MenuDropdown
        open={open}
        onKeyDown={onDropdownKeyDown}
        dropdownRef={dropdownRef}
      >
        {children}
      </MenuDropdown>
    </div>
  )
}

function MenuDropdown({
  open,
  onKeyDown,
  dropdownRef,
  children,
}: {
  open: boolean
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  dropdownRef: (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const phase = useExitPhase(open)
  if (!phase.render) return null
  return (
    <div
      role="menu"
      ref={dropdownRef}
      onKeyDown={onKeyDown}
      className={`popover-panel surface-glass absolute left-0 top-full z-50 mt-1 flex min-w-48 flex-col p-1.5 ${popoverMotionClass(phase.exiting)}`}
    >
      {children}
    </div>
  )
}
