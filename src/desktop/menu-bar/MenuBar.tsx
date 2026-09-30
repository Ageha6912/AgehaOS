import { useEffect, useRef, useState, type ReactNode } from 'react'

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
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  onHoverSwitch: () => void
  children: ReactNode
}) {
  return (
    <div className="relative flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-text-muted hover:bg-surface-raised hover:text-text aria-expanded:bg-surface-raised aria-expanded:text-text"
        onClick={onToggle}
        onPointerEnter={onHoverSwitch}
      >
        {label}
      </button>
      <MenuDropdown open={open}>{children}</MenuDropdown>
    </div>
  )
}

function MenuDropdown({ open, children }: { open: boolean; children: ReactNode }) {
  const phase = useExitPhase(open)
  if (!phase.render) return null
  return (
    <div
      role="menu"
      className={`popover-panel surface-glass absolute left-0 top-full z-50 mt-1 flex min-w-48 flex-col p-1.5 ${popoverMotionClass(phase.exiting)}`}
    >
      {children}
    </div>
  )
}
