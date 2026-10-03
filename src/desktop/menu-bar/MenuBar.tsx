import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

import { BatteryHigh, Check, CloudArrowUp } from '@phosphor-icons/react'

import { launchApp } from '@/apps/launch'
import { requestSettingsSection } from '@/apps/app-deep-link'
import { BrandLogo } from '@/components/brand-logo'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { isRemoteAuthActive } from '@/core/auth'
import { useTranslation } from '@/core/i18n'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import { SYNC_TOGGLE_EVENT, isSyncEnabled } from '@/services/settings-sync'
import { NotificationCenter } from '@/desktop/taskbar/NotificationCenter'
import { useClock } from '@/desktop/taskbar/use-clock'
import { UserMenu } from '@/desktop/taskbar/UserMenu'
import { useSearchStore } from '@/store/search-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import { altShortcutLabel, redoShortcutLabel, shortcutLabel } from '@/core/platform'
import { cycleWindows } from '@/desktop/use-global-shortcuts'

import { ShortcutsDialog } from './ShortcutsDialog'
import { MenuBarWorldSignals } from './WorldSignals'

type MenuId = 'file' | 'view' | 'window' | 'help'

/** 触发器顺序（键盘左右遍历的环；Shell 2.0 四菜单：原「编辑」并入文件菜单）。 */
const MENU_IDS: MenuId[] = ['file', 'view', 'window', 'help']

/** Battery Status API 的最小形状（Chromium 可用；其余环境 null 即隐藏）。 */
interface BatteryLike {
  level: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/** 电池电量（真实数据源：navigator.getBattery；不支持的环境返回 null 不渲染）。 */
function useBatteryLevel(): number | null {
  const [level, setLevel] = useState<number | null>(null)
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
    let battery: BatteryLike | null = null
    let cancelled = false
    const sync = (): void => setLevel(Math.round((battery?.level ?? 0) * 100))
    nav.getBattery
      ?.()
      .then((value) => {
        if (cancelled) return
        battery = value
        sync()
        value.addEventListener('levelchange', sync)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      battery?.removeEventListener('levelchange', sync)
    }
  }, [])
  return level
}

/**
 * 顶部菜单栏（docs/DESIGN.md §19；Shell 2.0 OS Menu Bar，2026-10-02）：
 * 左 = 品牌 + 四菜单（文件/视图/窗口/帮助——原「编辑」菜单 6 项文档级
 * execCommand 真实动作整体并入文件菜单第二分组，能力零删除，§1① 裁决），
 * 右 = 状态簇（System 纯指示电池 + Cloud 同步状态深链
 * 设置账户分区 + 通知中心 + 用户菜单 + 日期时钟最右，§1② 裁决）。
 * 键盘走 Tab/Enter/Esc/箭头（§19 P2-4），关闭语义与右键菜单一致。
 */
export function MenuBar() {
  const { t, locale } = useTranslation()
  const clock = useClock()
  const battery = useBatteryLevel()
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const rootRef = useRef<HTMLElement | null>(null)

  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const windows = useWindowStore((s) => s.windows)
  const focus = useWindowStore((s) => s.focus)
  const restore = useWindowStore((s) => s.restore)
  const minimize = useWindowStore((s) => s.minimize)
  const closeWindow = useWindowStore((s) => s.close)

  // Cloud 要素（§1②）：同步状态指示（与左栏云同步项同数据源）+ 深链设置
  // 账户分区；开关切换事件驱动重渲染（与 Sidebar 同款 SYNC_TOGGLE_EVENT 模式）。
  const [syncTick, setSyncTick] = useState(0)
  useEffect(() => {
    const onToggle = (): void => setSyncTick((value) => value + 1)
    window.addEventListener(SYNC_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(SYNC_TOGGLE_EVENT, onToggle)
  }, [])
  void syncTick

  const syncAvailable = isRemoteAuthActive()
  const syncOn = syncAvailable && isSyncEnabled()
  const syncHint = syncOn
    ? t('sidebar.syncOn')
    : syncAvailable
      ? t('sidebar.syncOff')
      : t('sidebar.syncLocal')
  const cloudTitle = `${t('sidebar.sync')} · ${syncHint}`

  // 菜单栏自带 Esc/外部按下/键盘模型，只参与全局弹层互斥（UI 评审 P0-2）。
  usePopoverDismiss('menubar', openMenu !== null, () => setOpenMenu(null), { dismissible: false })

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
  // 「编辑」菜单 = 文档级命令（聚焦可编辑处生效；权限拒绝静默——浏览器
  // 不放行剪贴板写入时按钮退化为无操作，与桌面 OS 菜单语义一致）。
  const execEdit = (command: string, value?: string): void => {
    act(() => {
      try {
        document.execCommand(command, false, value)
      } catch {
        /* 命令不可用：静默 */
      }
    })
  }
  const pasteFromClipboard = (): void => {
    act(() => {
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (!text) return
          try {
            document.execCommand('insertText', false, text)
          } catch {
            /* 目标不可编辑：静默 */
          }
        })
        .catch(() => {})
    })
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

  // 日期（参考图右侧「9月29日 周一」）；时钟每秒重渲染，无需独立计时。
  const dateLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date())

  return (
    <header
      ref={rootRef}
      data-testid="menu-bar"
      className="desktop-chrome glass-hint menubar-glass surface-glass fixed inset-x-0 top-0 z-[41] flex h-[var(--ag-menubar-height)] items-center gap-1 border-b border-border-subtle px-2.5 shadow-soft"
    >
      <div className="flex items-center gap-1.5 pr-1">
        <BrandLogo size={18} />
        <span className="hidden text-[13px] font-semibold text-text sm:inline">
          {t('menubar.brand')}
        </span>
      </div>

      {/* 窄屏（<640px）收起菜单标签，只留品牌 + 系统状态（§25）。 */}
      <nav aria-label={t('menubar.label')} className="hidden items-center gap-0.5 sm:flex">
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
          shortcut={shortcutLabel('K')}
          onSelect={() => act(() => useSearchStore.getState().setOpen(true))}
        />
        {/* 第二分组 = 原「编辑」菜单整体迁移（§1① 裁决，能力零删除）。 */}
        <MenuSeparator />
        <MenuItem label={t('menubar.edit.undo')} shortcut={shortcutLabel('Z')} onSelect={() => execEdit('undo')} />
        <MenuItem label={t('menubar.edit.redo')} shortcut={redoShortcutLabel()} onSelect={() => execEdit('redo')} />
        <MenuSeparator />
        <MenuItem label={t('menubar.edit.cut')} shortcut={shortcutLabel('X')} onSelect={() => execEdit('cut')} />
        <MenuItem label={t('menubar.edit.copy')} shortcut={shortcutLabel('C')} onSelect={() => execEdit('copy')} />
        <MenuItem
          label={t('menubar.edit.paste')}
          shortcut={shortcutLabel('V')}
          onSelect={() => pasteFromClipboard()}
        />
        <MenuSeparator />
        <MenuItem
          label={t('menubar.edit.selectAll')}
          shortcut={shortcutLabel('A')}
          onSelect={() => execEdit('selectAll')}
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
          label={t('menubar.window.next')}
          shortcut={altShortcutLabel('W')}
          disabled={windows.filter((win) => win.state !== 'minimized').length < 2}
          onSelect={() => act(cycleWindows)}
        />
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
          label={t('menubar.help.shortcuts')}
          onSelect={() => act(() => setShortcutsOpen(true))}
        />
        <MenuSeparator />
        <MenuItem
          label={t('menubar.help.about')}
          onSelect={() => act(() => launchApp('com.ageha.settings'))}
        />
      </MenuEntry>

      </nav>

      {shortcutsOpen && (
        <ShortcutsDialog
          onClose={() => {
            setShortcutsOpen(false)
            triggerRefs.current['help']?.focus()
          }}
        />
      )}

      {/* 系统状态区：只放浏览器读得到的真实状态（电池；Web 读不到 Wi-Fi/蓝牙，
          不画装饰性图标）→ 今日世界信号小字（§6.3 透明性）→ Cloud 同步状态深链
          → 通知中心 → 用户 → 时钟最右（macOS 惯例；时钟为等宽数据读出）。 */}
      <div className="ml-auto flex items-center gap-1.5">
        {battery !== null && (
          <span
            className="flex h-6 items-center gap-0.5 text-[11px] tabular-nums text-text-muted"
            title={t('menubar.status.battery')}
          >
            <BatteryHigh size={15} weight="regular" />
            {battery}%
          </span>
        )}
        <MenuBarWorldSignals />
        <button
          type="button"
          aria-label={cloudTitle}
          title={cloudTitle}
          className={`flex h-6 items-center ${
            syncOn ? 'text-primary' : syncAvailable ? 'text-text-muted' : 'text-disabled'
          }`}
          onClick={() => {
            requestSettingsSection('account')
            launchApp('com.ageha.settings')
          }}
        >
          <CloudArrowUp size={14} weight="bold" />
        </button>
        <NotificationCenter />
        <UserMenu />
        <time data-testid="menu-bar-clock" className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-text-muted">
          <span>{dateLabel}</span>
          <span>{clock}</span>
        </time>
      </div>
    </header>
  )
}

/** 显示写法 → aria-keyshortcuts 规范写法（`⇧⌘Z` → `Shift+Meta+Z`）。 */
function toAriaShortcut(label: string): string {
  const glyphs: Record<string, string> = { '⌘': 'Meta+', '⌥': 'Alt+', '⇧': 'Shift+' }
  return label.replace(/[⌘⌥⇧]/g, (glyph) => glyphs[glyph] ?? '').replace('Ctrl+', 'Control+')
}

/** 菜单项（role=menuitem）：勾选位对齐（无勾选时占位），禁用态半透明。 */
function MenuItem({
  label,
  checked,
  disabled,
  shortcut,
  onSelect,
}: {
  label: string
  checked?: boolean
  disabled?: boolean
  /** 右对齐的快捷键提示（按平台写法，见 core/platform）。 */
  shortcut?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-keyshortcuts={shortcut ? toAriaShortcut(shortcut) : undefined}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text hover:bg-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={onSelect}
    >
      <span
        aria-hidden="true"
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-primary"
      >
        {checked ? <Check size={12} weight="bold" /> : null}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {shortcut && (
        <kbd aria-hidden="true" className="ml-auto shrink-0 pl-4 font-sans text-[11px] text-text-muted">
          {shortcut}
        </kbd>
      )}
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
        className="flex h-7 items-center rounded-md px-2 text-[13px] font-medium text-text-muted hover:bg-surface-raised hover:text-text aria-expanded:bg-surface-raised aria-expanded:text-text"
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
