import { useEffect, useState, type ReactNode } from 'react'

import {
  Bell,
  CloudArrowUp,
  FolderOpen,
  GearSix,
  Monitor,
  Storefront,
  TerminalWindow,
} from '@phosphor-icons/react'

import { launchApp } from '@/apps/launch'
import { isRemoteAuthActive } from '@/core/auth'
import { useTranslation } from '@/core/i18n'
import { SYNC_TOGGLE_EVENT, isSyncEnabled, setSyncEnabled } from '@/services/settings-sync'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 左侧系统导航栏（docs/DESIGN.md §26，Phase 2 P2-2）：权威图的左侧竖排
 * 导航落地为「系统快捷操作轨」——与 Dock（运行中应用）、启动器（全部应用）
 * 职责正交。只放真实动作（拒绝装饰性谎言）：
 * 桌面=最小化全部、文件/终端/商店/设置=启动器、云同步=真实开关（本地模式
 * 禁用）、通知=唤起与顶栏铃铛共享的通知中心面板（store 化开合）。
 * 图中「用户中心」不建（与顶栏用户菜单重复）。<640px 隐藏（§25）。
 */
export function Sidebar() {
  const { t } = useTranslation()
  const windows = useWindowStore((s) => s.windows)
  const minimize = useWindowStore((s) => s.minimize)
  const items = useNotificationStore((s) => s.items)
  const togglePanel = useNotificationStore((s) => s.togglePanel)
  const unread = unreadCount(items)

  // 云同步开关持久化在 localStorage + 窗口事件（settings-sync 无 store）。
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

  const showDesktop = (): void => {
    for (const win of [...windows]) {
      if (win.state !== 'minimized') minimize(win.id)
    }
  }

  return (
    <nav
      aria-label={t('sidebar.label')}
      data-testid="sidebar"
      className="surface-glass fixed bottom-0 left-0 top-[var(--ag-menubar-height)] z-40 hidden w-[var(--ag-rail-left-width)] flex-col gap-0.5 border-r border-border-subtle px-2 py-3 sm:flex"
    >
      <SidebarItem
        testid="sidebar-desktop"
        label={t('sidebar.desktop')}
        icon={<Monitor size={18} weight="regular" />}
        onClick={showDesktop}
      />
      <SidebarItem
        testid="sidebar-files"
        label={t('sidebar.files')}
        icon={<FolderOpen size={18} weight="regular" />}
        onClick={() => launchApp('com.ageha.files')}
      />
      <SidebarItem
        testid="sidebar-terminal"
        label={t('sidebar.terminal')}
        icon={<TerminalWindow size={18} weight="regular" />}
        onClick={() => launchApp('com.ageha.terminal')}
      />
      <SidebarItem
        testid="sidebar-store"
        label={t('sidebar.store')}
        icon={<Storefront size={18} weight="regular" />}
        onClick={() => launchApp('com.ageha.store')}
      />
      <SidebarItem
        testid="sidebar-settings"
        label={t('sidebar.settings')}
        icon={<GearSix size={18} weight="regular" />}
        onClick={() => launchApp('com.ageha.settings')}
      />
      <SidebarItem
        testid="sidebar-sync"
        label={t('sidebar.sync')}
        icon={<CloudArrowUp size={18} weight="regular" />}
        hint={`${t('sidebar.sync')} · ${syncHint}`}
        stateDot={syncOn}
        disabled={!syncAvailable}
        onClick={() => setSyncEnabled(!isSyncEnabled())}
      />
      <SidebarItem
        testid="sidebar-notifications"
        label={t('sidebar.notifications')}
        icon={<Bell size={18} weight="regular" />}
        badge={unread}
        onClick={togglePanel}
      />
    </nav>
  )
}

function SidebarItem({
  testid,
  label,
  icon,
  hint,
  stateDot,
  badge,
  disabled,
  onClick,
}: {
  testid: string
  label: string
  icon: ReactNode
  hint?: string
  /** 开启态小圆点（云同步）。 */
  stateDot?: boolean
  /** 计数徽标（通知未读）。 */
  badge?: number
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      title={hint ?? label}
      disabled={disabled}
      onClick={onClick}
      className="relative flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      <span aria-hidden="true" className="flex">
        {icon}
      </span>
      <span>{label}</span>
      {stateDot && (
        <span
          aria-hidden="true"
          className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-primary"
        />
      )}
      {badge !== undefined && badge > 0 && (
        <span
          aria-hidden="true"
          data-testid="sidebar-unread"
          className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-contrast"
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}
