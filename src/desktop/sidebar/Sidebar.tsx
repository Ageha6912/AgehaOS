import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import {
  Bell,
  CloudArrowUp,
  FolderOpen,
  GearSix,
  Monitor,
  Storefront,
  TerminalWindow,
  UserCircle,
} from '@phosphor-icons/react'

import { launchApp } from '@/apps/launch'
import { requestSettingsSection } from '@/apps/app-deep-link'
import { isRemoteAuthActive } from '@/core/auth'
import { useTranslation } from '@/core/i18n'
import { SYNC_TOGGLE_EVENT, isSyncEnabled, setSyncEnabled } from '@/services/settings-sync'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 左侧系统导航栏（docs/DESIGN.md §26；2026-10-03 用户裁决「单栏 + 名称右置 +
 * 拉长」）：行式条目——瓷贴（36px 彩色渐变方块）在左、应用名称在右；组容器
 * （system-rails）从菜单栏下方一点锚到 Dock 上方一点，整列拉长。八项顺序 =
 * 桌面/商店/文件/终端/设置/云同步/通知/用户中心，只放真实动作：桌面=最小化
 * 全部、商店/文件/终端/设置=启动器、用户中心=Settings 落账户分区（深链）、
 * 云同步=真实开关（本地模式禁用）、通知=唤起共享通知中心。无「当前项」语义，
 * 不设常亮选中底（hover bg-surface-raised 瞬态）。名称常显后自绘气泡 tooltip
 * 退役（原生 title 保留承载云同步组合提示）。
 * 2026-10-03「两栏毛玻璃连成一体」：玻璃面仍归 Desktop 的 system-rails 组
 * 容器；今日应用列随「合并为一栏」裁决退役。
 */

/** 瓷贴渐变（参考图取色；每项独立配色，白字形统一）。 */
const TILE_GRADIENTS = {
  desktop: 'linear-gradient(150deg, #5aa9f8, #2f6fed)',
  store: 'linear-gradient(150deg, #7c8ef8, #4f46e5)',
  files: 'linear-gradient(150deg, #38c8e8, #0e9fc4)',
  terminal: 'linear-gradient(150deg, #3a4356, #1c2433)',
  // 设置/通知与终端曾同为深藏青、难以区分（UI 评审 P1-3）：设置改中性钢灰，
  // 通知取 accent 族洋红。
  settings: 'linear-gradient(150deg, #94a3b8, #5b6b82)',
  sync: 'linear-gradient(150deg, #4a9df8, #1f7af0)',
  notifications: 'linear-gradient(150deg, #e879f9, #c026d3)',
  user: 'linear-gradient(150deg, #6ea0f8, #7c5cf0)',
} as const

function Tile({ gradient, glyph }: { gradient: string; glyph: ReactNode }) {
  const style: CSSProperties = { backgroundImage: gradient }
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-[0_1px_2px_rgba(15,23,42,0.25)] ring-1 ring-inset ring-white/25"
      style={style}
    >
      {glyph}
    </span>
  )
}

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

  const openUserCenter = (): void => {
    // 深链：Settings 直接落在「账户」分区（§32 用户中心语义）。
    requestSettingsSection('account')
    launchApp('com.ageha.settings')
  }

  return (
    <nav
      aria-label={t('sidebar.label')}
      data-testid="sidebar"
      className="scroll-thin flex min-h-0 w-[calc(var(--ag-rail-left-width)-0.5rem)] flex-col gap-1 overflow-y-auto px-2 py-3"
    >
      <SidebarItem
        testid="sidebar-desktop"
        label={t('sidebar.desktop')}
        tile={<Tile gradient={TILE_GRADIENTS.desktop} glyph={<Monitor size={18} weight="fill" color="#ffffff" />} />}
        onClick={showDesktop}
      />
      <SidebarItem
        testid="sidebar-store"
        label={t('sidebar.store')}
        tile={<Tile gradient={TILE_GRADIENTS.store} glyph={<Storefront size={18} weight="fill" color="#ffffff" />} />}
        onClick={() => launchApp('com.ageha.store')}
      />
      <SidebarItem
        testid="sidebar-files"
        label={t('sidebar.files')}
        tile={<Tile gradient={TILE_GRADIENTS.files} glyph={<FolderOpen size={18} weight="fill" color="#ffffff" />} />}
        onClick={() => launchApp('com.ageha.files')}
      />
      <SidebarItem
        testid="sidebar-terminal"
        label={t('sidebar.terminal')}
        tile={<Tile gradient={TILE_GRADIENTS.terminal} glyph={<TerminalWindow size={18} weight="fill" color="#ffffff" />} />}
        onClick={() => launchApp('com.ageha.terminal')}
      />
      <SidebarItem
        testid="sidebar-settings"
        label={t('sidebar.settings')}
        tile={<Tile gradient={TILE_GRADIENTS.settings} glyph={<GearSix size={18} weight="fill" color="#ffffff" />} />}
        onClick={() => launchApp('com.ageha.settings')}
      />
      <SidebarItem
        testid="sidebar-sync"
        label={t('sidebar.sync')}
        tile={<Tile gradient={TILE_GRADIENTS.sync} glyph={<CloudArrowUp size={18} weight="fill" color="#ffffff" />} />}
        hint={`${t('sidebar.sync')} · ${syncHint}`}
        stateDot={syncOn}
        disabled={!syncAvailable}
        onClick={() => setSyncEnabled(!isSyncEnabled())}
      />
      <SidebarItem
        testid="sidebar-notifications"
        label={t('sidebar.notifications')}
        tile={<Tile gradient={TILE_GRADIENTS.notifications} glyph={<Bell size={18} weight="fill" color="#ffffff" />} />}
        badge={unread}
        popoverTrigger="notifications"
        onClick={togglePanel}
      />
      <SidebarItem
        testid="sidebar-user-center"
        label={t('sidebar.userCenter')}
        tile={<Tile gradient={TILE_GRADIENTS.user} glyph={<UserCircle size={18} weight="fill" color="#ffffff" />} />}
        onClick={openUserCenter}
      />
    </nav>
  )
}

function SidebarItem({
  testid,
  label,
  tile,
  hint,
  stateDot,
  badge,
  popoverTrigger,
  disabled,
  onClick,
}: {
  testid: string
  label: string
  tile: ReactNode
  hint?: string
  /** 开启态小圆点（云同步）。 */
  stateDot?: boolean
  /** 计数徽标（通知未读）。 */
  badge?: number
  /** 外部弹层触发器标记：在该弹层打开时点击本项不算「外部按下」。 */
  popoverTrigger?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-popover-trigger={popoverTrigger}
      aria-label={label}
      title={hint ?? label}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-text hover:bg-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="relative shrink-0">
        {tile}
        {stateDot && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary"
          />
        )}
        {badge !== undefined && badge > 0 && (
          <span
            aria-hidden="true"
            data-testid="sidebar-unread"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-contrast"
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {/* 名称常显（2026-10-03 裁决「名称在图标右方」）：自绘气泡 tooltip 退役，
          原生 title 保留承载云同步组合提示。 */}
      <span className="min-w-0 flex-1 truncate text-left text-[13px]">{label}</span>
    </button>
  )
}
