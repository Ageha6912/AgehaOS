import { useEffect, useState, type ComponentType, type ReactNode } from 'react'

import {
  Bell,
  Code,
  FolderOpen,
  GearSix,
  GraduationCap,
  Monitor,
  Notebook,
  PaintBrush,
  SquaresFour,
  TerminalWindow,
  User,
} from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName, launchApp } from '@/apps/launch'
import { BrandLogo } from '@/components/brand-logo'
import { greetingTitleKey } from '@/core/dynamic/content/engine'
import { timePhaseOf } from '@/core/dynamic/generative/seed'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { launcherWorkspaceScore, rankByScore } from '@/desktop/workspace/affinity'
import type { WorkspacePanelController } from '@/desktop/workspace/use-workspace-panel'
import { useAppStore } from '@/store/app-store'
import { useLauncherStore } from '@/store/launcher-store'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { useUsageStore } from '@/store/usage-store'
import { useWindowStore } from '@/store/window-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import type { WorkspaceId } from '@/store/workspace-store'

/**
 * 左侧 Workspace Rail + Workspace Panel（Desktop Shell 3.0 STEP 2，§33.2
 * 浮岛基线）：窄轨漂浮垂直居中，玻璃面归 Desktop 的 system-rails 组容器。
 * icon-first——44px 圆钮 + 20px 字形，名称走自绘 os-tooltip 气泡（group
 * hover/focus 点亮，不进可达树），hover/active 一律轻 translucent capsule
 * （chrome 作用域 surface-raised/elevated 白玻璃），禁实心色块。
 *
 * STEP 2 展开（docs/DESIGN.md §33.4.1 之后的 Workspace Panel 切片）：hover /
 * click（品牌钮 pin）/ 键盘聚焦任一路触发 `data-expanded`，轨道由 80px 宽
 * 过渡到 324px（--ag-rail-left-expanded-width，纯浮层几何，窗口布局钳制仍
 * 钉 RAIL_LEFT_WIDTH_PX=80）。面板是连续的 Workspace Environment（不切成
 * 一堆 card）：品牌区（BrandLogo + 字标 + 标语）→ 今日空间（真实日期 +
 * 按当前用户问候，greeting 引擎 timePhase）→ 工作空间 selector（真实持久
 * 化，排序影响见 affinity.ts）→ 最近使用（usage-store 真实数据）。收起：
 * 鼠标离开（240ms 宽限）/ Esc / 面板外按下（pin 态）；展开态下条目名称
 * 常显，os-tooltip 经 index.css `[data-expanded] .os-tooltip` 退出。
 * 组容器仍不得挂 overflow（收起态气泡向右伸出，§26 教训）——内容列的
 * overflow 是其自身盒子，不含气泡元素。
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
      {/* 自绘气泡（os-tooltip）：点亮规则在 index.css；展开态由
          [data-expanded] .os-tooltip display:none 退出（名称已常显）。 */}
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

/** 面板分区标题（11px 弱化，密度对齐启动器分区标签）。 */
function PanelHeading({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pb-1 text-[11px] font-medium text-text-muted">{children}</h2>
}

/** 工作空间 selector 元数据（图标 + 双语标签键；四个 id 来自 workspace-store）。 */
const WORKSPACE_META: Array<{
  id: WorkspaceId
  labelKey: MessageKey
  icon: ComponentType<{ size?: number; weight?: 'fill'; color?: string }>
}> = [
  { id: 'personal', labelKey: 'workspace.space.personal', icon: User },
  { id: 'study', labelKey: 'workspace.space.study', icon: GraduationCap },
  { id: 'dev', labelKey: 'workspace.space.dev', icon: Code },
  { id: 'creative', labelKey: 'workspace.space.creative', icon: PaintBrush },
]

/** 面板时钟：日期 + 问候相位取样（30s 粒度，非动效——不触发连续 render）。 */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/** 展开态内容列（Workspace Environment）：品牌区 → 今日空间 → 工作空间 → 最近使用。 */
function WorkspacePanelBody({ expanded }: { expanded: boolean }) {
  const { t, locale } = useTranslation()
  const user = useSessionStore((s) => s.user)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace)
  const installedApps = useAppStore((s) => s.apps)
  const recent = useUsageStore((s) => s.recent)
  const now = useNow()

  // 今日空间：真实日期（locale 感知）+ 问候引擎时段 + 当前用户称呼。
  const dateText = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(now)
  const phase = timePhaseOf(now.getHours())
  const displayName = user ? (user.displayName ?? user.username) : null

  // 最近使用（§22 同源）：usage-store 真实记录 × 仍安装过滤 × 工作空间
  // 亲和稳定排序（同分保持时序），面板取前 4。
  const recentApps = rankByScore(
    recent
      .map((entry) => installedApps.find((app) => app.id === entry.appId))
      .filter((app) => app !== undefined),
    (app) => launcherWorkspaceScore(app.id, workspace),
  ).slice(0, 4)

  return (
    <div
      id="workspace-panel"
      data-testid="workspace-panel"
      data-expanded={expanded || undefined}
      aria-hidden={!expanded}
      // 收起态整列 inert：不可聚焦、不进可达树（展开动画期间同帧生效）。
      inert={!expanded}
      className="h-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto scroll-thin opacity-0 -translate-x-2 pointer-events-none [transition:opacity_var(--ag-motion-fast)_var(--ag-motion-ease),transform_var(--ag-motion-fast)_var(--ag-motion-ease)] data-[expanded]:pointer-events-auto data-[expanded]:opacity-100 data-[expanded]:translate-x-0 data-[expanded]:[transition:opacity_var(--ag-motion-base)_var(--ag-motion-ease)_60ms,transform_var(--ag-motion-base)_var(--ag-motion-ease)_60ms]"
    >
      <div className="flex w-[15.25rem] flex-col gap-2.5 pb-1 pl-1 pr-2 pt-0.5">
        {/* 品牌区（§10 BrandLogo 复用）：字标 + 标语，纯展示。 */}
        <div className="flex items-center gap-2.5 px-1 py-0.5">
          <BrandLogo size={26} className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight text-text">
              {t('menubar.brand')}
            </p>
            <p className="truncate text-[10px] leading-tight text-text-tertiary">
              {t('desktop.brandTagline')}
            </p>
          </div>
        </div>

        {/* 今日空间：真实日期 + 按当前用户的问候（问候引擎时段模板）。 */}
        <section>
          <PanelHeading>{t('workspace.panel.today')}</PanelHeading>
          <div data-testid="workspace-today" className="rounded-lg bg-surface-raised px-2.5 py-1.5">
            <p className="text-[11px] leading-snug text-text-muted">{dateText}</p>
            <p className="mt-0.5 truncate text-[13px] font-medium leading-snug text-text">
              {t(greetingTitleKey(phase))}
              {displayName && (
                <span className="font-normal text-text-muted">
                  {t('workspace.panel.greetingJoin')}
                  {displayName}
                </span>
              )}
            </p>
          </div>
        </section>

        {/* 工作空间 selector（本阶段只做 selector：不改窗口 workspace）；
            选择持久化 + 真实影响排序（affinity.ts）。选中态 = 启动器分类
            轨同款主色 capsule（§22 选中语言）。 */}
        <section>
          <PanelHeading>{t('workspace.panel.workspaces')}</PanelHeading>
          <div role="group" aria-label={t('workspace.panel.workspaces')} className="flex flex-col gap-0.5">
            {WORKSPACE_META.map(({ id, labelKey, icon: Icon }) => {
              const checked = workspace === id
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`workspace-option-${id}`}
                  aria-pressed={checked}
                  className={`flex h-7 items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors ${
                    checked
                      ? 'bg-primary font-medium text-primary-contrast'
                      : 'text-text-muted hover:bg-surface-raised hover:text-text'
                  }`}
                  onClick={() => setWorkspace(id)}
                >
                  <Icon size={14} weight="fill" aria-hidden="true" />
                  <span className="min-w-0 truncate">{t(labelKey)}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 最近使用：真实 usage-store 数据；空态如实提示（拒绝装饰性谎言）。 */}
        <section>
          <PanelHeading>{t('workspace.panel.recent')}</PanelHeading>
          {recentApps.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {recentApps.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    data-testid="workspace-recent-item"
                    onClick={() => launchApp(app.id)}
                    className="flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-surface-raised"
                  >
                    <AppIcon appId={app.id} size={20} />
                    <span className="min-w-0 truncate text-xs text-text">
                      {appDisplayName(app.id)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-[11px] leading-snug text-text-tertiary">
              {t('workspace.panel.recentEmpty')}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

export function Sidebar({ panel }: { panel: WorkspacePanelController }) {
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

  const brandLabel = panel.expanded ? t('workspace.panel.collapse') : t('workspace.panel.expand')

  return (
    <nav
      aria-label={t('sidebar.label')}
      data-testid="sidebar"
      data-expanded={panel.expanded || undefined}
      className={`flex flex-col py-3 transition-[width] [transition-duration:var(--ag-motion-base)] [transition-timing-function:var(--ag-motion-ease)] ${
        panel.expanded
          ? 'w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)]'
          : 'w-[calc(var(--ag-rail-left-width)-0.5rem)]'
      }`}
    >
      <div className="flex items-start">
        {/* 图标列：窄轨本体（两态恒 72px，展开时原地不动）。 */}
        <div className="flex w-[calc(var(--ag-rail-left-width)-0.5rem)] shrink-0 flex-col items-center gap-1">
          {/* 品牌钮 = 展开固定（pin）开关：键盘开合的可达入口。 */}
          <button
            type="button"
            data-testid="sidebar-brand"
            aria-expanded={panel.expanded}
            aria-controls="workspace-panel"
            aria-label={brandLabel}
            onClick={panel.togglePin}
            className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised active:bg-surface-elevated"
          >
            {/* Ageha Mark（§10 品牌主视觉）：装饰位，可访问名由按钮承载。 */}
            <BrandLogo size={28} className="opacity-90" />
            <span aria-hidden="true" className="os-tooltip">
              {brandLabel}
            </span>
          </button>
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
        </div>
        {/* 内容列：Workspace Panel（展开时经宽度过渡揭示；收起 inert）。 */}
        <WorkspacePanelBody expanded={panel.expanded} />
      </div>
    </nav>
  )
}
