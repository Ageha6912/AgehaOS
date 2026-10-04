import type { ComponentType, ReactNode } from 'react'

import {
  Bell,
  FolderOpen,
  GearSix,
  Monitor,
  Notebook,
  SquaresFour,
  TerminalWindow,
} from '@phosphor-icons/react'

import { launchApp } from '@/apps/launch'
import { BrandLogo } from '@/components/brand-logo'
import { useTranslation } from '@/core/i18n'
import { useLauncherStore } from '@/store/launcher-store'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 左侧 Workspace Rail（Desktop Shell 3.0 STEP 1，docs/DESIGN.md §33.2 浮岛
 * 基线回归）：窄轨漂浮、垂直居中，玻璃面归 Desktop 的 system-rails 组容器。
 * icon-first——44px 圆钮 + 20px 字形，名称走自绘 os-tooltip 气泡（group
 * hover/focus 点亮，不进可达树；原生 title 退役，同 Dock 惯例），hover/active
 * 一律轻 translucent capsule（chrome 作用域 surface-raised/elevated 白玻璃），
 * 禁实心色块。八位 = Ageha Mark（装饰）+ 桌面/启动器/文件/记事/终端/设置/
 * 通知。动作全部真实：桌面=最小化全部、启动器=共享启动器面板（launcher-store，
 * notification-store.panelOpen 同模式）、文件/记事/终端/设置=启动器、通知=
 * 唤起共享通知中心。商店/云同步/用户中心退出版面（入口仍在：商店=Dock 常驻
 * 瓷贴、云同步=顶栏 Cloud 按钮、用户中心=顶栏用户菜单）。
 * 展开态 Workspace Panel（hover/click → 面板内容）在下一切片；组容器无
 * overflow，向右伸出的 tooltip 不被裁剪。
 */

/** Rail 条目：图标 + 弱化文案（tooltip 承载）。 */
function RailItem({
  testid,
  label,
  icon: Icon,
  onClick,
  active,
  expandable,
  popoverTrigger,
  badge,
}: {
  testid: string
  label: string
  icon: ComponentType<{ size?: number; weight?: 'fill' | 'regular'; color?: string }>
  onClick: () => void
  /** 面板展开态（启动器/通知中心）：轻 capsule 常亮 + aria-expanded。 */
  active?: boolean
  /** 有开合语义的条目才发 aria-expanded（动作条目不发）。 */
  expandable?: boolean
  /** 外部弹层触发器标记：在该弹层打开时点击本项不算「外部按下」。 */
  popoverTrigger?: string
  /** 计数徽标（通知未读）。 */
  badge?: number
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-popover-trigger={popoverTrigger}
      data-active={active || undefined}
      aria-label={label}
      aria-expanded={expandable ? (active ?? false) : undefined}
      onClick={onClick}
      className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised active:bg-surface-elevated data-[active]:bg-surface-raised"
    >
      <Icon size={20} weight="fill" aria-hidden="true" />
      {/* 自绘气泡（os-tooltip）：本文件不分层，点亮规则在 index.css
          （.group:hover/.group:focus-visible）——aria-hidden 不进可达树。 */}
      <span aria-hidden="true" className="os-tooltip">
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span
          aria-hidden="true"
          data-testid="sidebar-unread"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-contrast"
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const windows = useWindowStore((s) => s.windows)
  const minimize = useWindowStore((s) => s.minimize)
  const items = useNotificationStore((s) => s.items)
  const panelOpen = useNotificationStore((s) => s.panelOpen)
  const togglePanel = useNotificationStore((s) => s.togglePanel)
  const launcherOpen = useLauncherStore((s) => s.launcherOpen)
  const toggleLauncher = useLauncherStore((s) => s.toggleLauncher)
  const unread = unreadCount(items)

  const showDesktop = (): void => {
    for (const win of [...windows]) {
      if (win.state !== 'minimized') minimize(win.id)
    }
  }

  const mark: ReactNode = (
    // Ageha Mark（§10 品牌主视觉）：装饰位，不进可达树、不截 Tab。
    <div aria-hidden="true" className="flex h-11 shrink-0 items-center justify-center">
      <BrandLogo size={28} className="opacity-90" />
    </div>
  )

  return (
    <nav
      aria-label={t('sidebar.label')}
      data-testid="sidebar"
      className="flex w-[calc(var(--ag-rail-left-width)-0.5rem)] flex-col items-center gap-1 py-3"
    >
      {mark}
      <RailItem
        testid="sidebar-desktop"
        label={t('sidebar.desktop')}
        icon={Monitor}
        onClick={showDesktop}
      />
      <RailItem
        testid="sidebar-launcher"
        label={t('sidebar.launcher')}
        icon={SquaresFour}
        onClick={toggleLauncher}
        active={launcherOpen}
        expandable
        popoverTrigger="launcher"
      />
      <RailItem
        testid="sidebar-files"
        label={t('sidebar.files')}
        icon={FolderOpen}
        onClick={() => launchApp('com.ageha.files')}
      />
      <RailItem
        testid="sidebar-notes"
        label={t('sidebar.notes')}
        icon={Notebook}
        onClick={() => launchApp('com.ageha.notes')}
      />
      <RailItem
        testid="sidebar-terminal"
        label={t('sidebar.terminal')}
        icon={TerminalWindow}
        onClick={() => launchApp('com.ageha.terminal')}
      />
      <RailItem
        testid="sidebar-settings"
        label={t('sidebar.settings')}
        icon={GearSix}
        onClick={() => launchApp('com.ageha.settings')}
      />
      <RailItem
        testid="sidebar-notifications"
        label={t('sidebar.notifications')}
        icon={Bell}
        onClick={togglePanel}
        active={panelOpen}
        expandable
        popoverTrigger="notifications"
        badge={unread}
      />
    </nav>
  )
}
