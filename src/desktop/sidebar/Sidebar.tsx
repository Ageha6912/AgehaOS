import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import {
  Bell,
  CaretLeft,
  CaretRight,
  CaretUp,
  Code,
  FolderOpen,
  GearSix,
  GraduationCap,
  Monitor,
  Notebook,
  PaintBrush,
  Sparkle,
  SquaresFour,
  TerminalWindow,
  User,
} from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName, launchApp } from '@/apps/launch'
import { BrandLogo } from '@/components/brand-logo'
import { useLiquidDisplacementMap } from '@/desktop/sidebar/liquid-glass'
import { LiquidGlassDefs } from '@/desktop/sidebar/LiquidGlassFilter'
import { utcDayKey } from '@/core/eclosion/world'
import { greetingTitleKey } from '@/core/dynamic/content/engine'
import { timePhaseOf } from '@/core/dynamic/generative/seed'
import { useTranslation, formatMessage } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { launcherWorkspaceScore, rankByScore } from '@/desktop/workspace/affinity'
import type { WorkspacePanelController } from '@/desktop/workspace/use-workspace-panel'
import { DEFAULT_WALLPAPER_SRC } from '@/desktop/wallpaper/WallpaperLayer'
import { requestLauncherCategory } from '@/desktop/taskbar/launcher-intent'
import { useAppStore } from '@/store/app-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { useLauncherStore } from '@/store/launcher-store'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { useUsageStore } from '@/store/usage-store'
import { useWindowStore } from '@/store/window-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import type { WorkspaceId } from '@/store/workspace-store'

/**
 * 左侧 Workspace Rail + Workspace Panel（Desktop Shell 3.0，§34 双岛口径）：
 * 窄轨与面板是**两块独立玻璃岛**——组容器（Desktop 的 system-rails）退化为
 * 纯定位层（顶锚菜单栏下方、Dock 上方收尾，pointer-events-none，岛间缝隙
 * 可穿透桌面），玻璃面/圆角/投影各自成岛。icon-first——44px 圆钮 + 20px
 * 字形，名称走自绘 os-tooltip 气泡（group hover/focus 点亮，不进可达树），
 * hover/active 一律轻 translucent capsule（chrome 作用域 surface-raised/
 * elevated 白玻璃），禁实心色块。液态玻璃（2026-10-02 裁决）仍由窄轨岛
 * 承担，位移图按岛实测尺寸生成。
 *
 * 展开（docs/DESIGN.md §34）：hover / click（品牌钮 pin）/ 键盘聚焦任一路
 * 触发 `data-expanded`，面板岛由 0 宽过渡到 316px（--ag-rail-left-expanded-
 * width，纯浮层几何，窗口布局钳制仍钉 RAIL_LEFT_WIDTH_PX=80）。面板是连续
 * 的 Workspace Environment（不切成一堆 card）：品牌区（BrandLogo + 字标 +
 * 标语）→ 今日空间（真实日期 + 按当前用户问候，greeting 引擎 timePhase）→
 * 工作空间 selector（真实持久化，排序影响见 affinity.ts）→ 最近使用
 * （usage-store 真实数据）→ 底部垫今日世界品牌入口（复用 eclosion-store
 * 世界摘要 + 「查看世界」直达启动器「今日」分类，WorkspaceTodayWorld）。
 * 收起：鼠标离开（240ms 宽限）/ Esc / 面板外按下（pin 态）；展开态下条目
 * 名称常显，os-tooltip 经 index.css `[data-expanded] .os-tooltip` 退出。
 * 组容器与窄轨岛仍不得挂 overflow（收起态气泡向右伸出，§26 教训）——
 * 面板岛自身的 overflow-hidden 只裁内容列（其内无 os-tooltip 元素）。
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
      className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-text transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated active:bg-surface-elevated data-[active]:bg-surface-elevated"
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

/** 面板可折叠分组（§34 参考图：分组头带 ˄ 折叠箭头，收起藏内容）。 */
function PanelSection({
  label,
  testid,
  children,
}: {
  label: string
  testid: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section>
      <button
        type="button"
        data-testid={`panel-section-${testid}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md px-1 pb-1 text-[11px] font-medium text-text-muted transition-colors hover:text-text"
      >
        {label}
        <CaretUp
          size={10}
          weight="bold"
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? '' : 'rotate-180'}`}
        />
      </button>
      {open ? children : null}
    </section>
  )
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

/**
 * 今日世界分区（Desktop Shell 3.0 STEP 3）：AgehaOS 独有的品牌入口，垫在
 * 面板底部（mt-auto 锚底 + hairline 分隔）。数据零新取数——复用羽化编排器
 * 写入 eclosion-store 的世界摘要（新应用数 = apps.length、趋势主题 =
 * headline、今日更新状态 = worldDate 对 utcDayKey），禁止假数据：
 * - 羽化关（默认）→ 整区不渲染（WorldSignals 同款门控；桌面保持安静）；
 * - 开但世界未落地（拉取中/503 静默降级）→ 安静空态，不渲染跳转钮
 *   （无数据可看时「查看世界」即死按钮，拒绝装饰性谎言）。
 * 「查看世界 →」= 打开启动器并直接落在「今日」分类（launcher-intent 一次
 * 性意图；面板收起走既有的弹层互斥，不在此重复收起逻辑）。
 */
function WorkspaceTodayWorld() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const world = useEclosionStore((s) => s.world)
  const setLauncherOpen = useLauncherStore((s) => s.setLauncherOpen)

  if (!enabled) return null

  // 「今日已更新」以当日世界为准（会话跨 UTC 零点的陈旧摘要如实标注）。
  const fresh = world !== null && world.worldDate === utcDayKey()

  return (
    <section aria-label={t('workspace.panel.world')} className="mt-auto border-t border-border-subtle pt-2">
      <PanelHeading>{t('workspace.panel.world')}</PanelHeading>
      {world === null ? (
        <p data-testid="workspace-world-empty" className="px-1 text-[11px] leading-snug text-text-tertiary">
          {t('workspace.panel.world.empty')}
        </p>
      ) : (
        <button
          type="button"
          data-testid="workspace-world-entry"
          aria-label={`${t('workspace.panel.world.view')}：${world.headline}`}
          onClick={() => {
            requestLauncherCategory('today')
            setLauncherOpen(true)
          }}
          className="flex w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised px-2 py-2 text-left transition-colors hover:bg-surface-elevated"
        >
          {/* ✦ 渐变角标（§34 参考图的缩略位）：品牌入口气质，非假数据图片。 */}
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--ag-capsule-active)] shadow-sm"
          >
            <Sparkle size={18} weight="fill" className="text-primary-contrast" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium leading-snug text-text">
              {world.headline}
            </span>
            <span className="mt-0.5 block truncate text-[11px] leading-snug text-text-muted">
              {formatMessage(t('workspace.panel.world.apps'), { count: String(world.apps.length) })}
              {' · '}
              {t(fresh ? 'workspace.panel.world.fresh' : 'workspace.panel.world.stale')}
            </span>
          </span>
          <CaretRight size={12} aria-hidden="true" className="shrink-0 text-primary" />
        </button>
      )}
    </section>
  )
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
      className="h-full min-w-0 overflow-x-hidden overflow-y-auto scroll-thin opacity-0 -translate-x-2 pointer-events-none [transition:opacity_var(--ag-motion-fast)_var(--ag-motion-ease),transform_var(--ag-motion-fast)_var(--ag-motion-ease)] data-[expanded]:pointer-events-auto data-[expanded]:opacity-100 data-[expanded]:translate-x-0 data-[expanded]:[transition:opacity_var(--ag-motion-base)_var(--ag-motion-ease)_60ms,transform_var(--ag-motion-base)_var(--ag-motion-ease)_60ms]"
    >
      <div className="flex w-full flex-col gap-3 px-3.5 pb-3 pt-3">
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

        {/* 今日空间：真实壁纸缩略图卡（§34 参考图口径）——缩略图 = 当前
            壁纸本身（DEFAULT_WALLPAPER_SRC，与桌面 PhotoSurface 同源，禁
            假数据），叠加文本 = 真实日期 + 问候引擎时段 + 当前用户称呼。 */}
        <section>
          <PanelHeading>{t('workspace.panel.today')}</PanelHeading>
          <div
            data-testid="workspace-today"
            className="relative h-24 overflow-hidden rounded-xl border border-border-subtle bg-cover bg-center"
            style={{ backgroundImage: `url(${DEFAULT_WALLPAPER_SRC})` }}
          >
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
            <div className="relative flex h-full flex-col justify-end gap-0.5 p-2.5">
              <p className="text-[11px] leading-snug text-white/90">{dateText}</p>
              <p className="truncate text-[13px] font-medium leading-snug text-white">
                {t(greetingTitleKey(phase))}
                {displayName && (
                  <span className="font-normal text-white/85">
                    {t('workspace.panel.greetingJoin')}
                    {displayName}
                  </span>
                )}
              </p>
            </div>
          </div>
        </section>

        {/* 工作空间 selector（本阶段只做 selector：不改窗口 workspace）；
            选择持久化 + 真实影响排序（affinity.ts）。选中态 = 同族明暗渐变
            胶囊（--ag-capsule-active，§34 参考图口径；primary 的 Active/
            Selected 配额内）。 */}
        <PanelSection label={t('workspace.panel.workspaces')} testid="workspaces">
          <div role="group" aria-label={t('workspace.panel.workspaces')} className="flex flex-col gap-1">
            {WORKSPACE_META.map(({ id, labelKey, icon: Icon }) => {
              const checked = workspace === id
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`workspace-option-${id}`}
                  aria-pressed={checked}
                  className={`flex h-9 items-center gap-2.5 rounded-xl px-2 text-left text-xs transition-colors ${
                    checked
                      ? 'bg-[var(--ag-capsule-active)] font-medium text-primary-contrast shadow-sm'
                      : 'text-text-muted hover:bg-surface-raised hover:text-text'
                  }`}
                  onClick={() => setWorkspace(id)}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                      checked ? 'bg-white/20' : 'bg-surface-raised'
                    }`}
                  >
                    <Icon size={13} weight="fill" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 truncate">{t(labelKey)}</span>
                  <CaretRight size={11} aria-hidden="true" className="ml-auto shrink-0 opacity-70" />
                </button>
              )
            })}
          </div>
        </PanelSection>

        {/* 最近使用：真实 usage-store 数据；空态如实提示（拒绝装饰性谎言）。 */}
        <PanelSection label={t('workspace.panel.recent')} testid="recent">
          {recentApps.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {recentApps.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    data-testid="workspace-recent-item"
                    onClick={() => launchApp(app.id)}
                    className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-surface-raised"
                  >
                    <AppIcon appId={app.id} size={22} />
                    <span className="min-w-0 truncate text-xs text-text">
                      {appDisplayName(app.id)}
                    </span>
                    <CaretRight size={11} aria-hidden="true" className="ml-auto shrink-0 opacity-60" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-[11px] leading-snug text-text-tertiary">
              {t('workspace.panel.recentEmpty')}
            </p>
          )}
        </PanelSection>

        {/* 今日世界（STEP 3）：品牌入口垫底——真实世界摘要 + 「查看世界」。
            羽化关不渲染（默认桌面保持安静）。 */}
        <WorkspaceTodayWorld />
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
  // 面板内容列首展才挂载（渲染期派生重置，React 官方模式，坑 4）：收起态
  // 不渲染问候/日期/最近——净桌面 reload 恢复预算（PRD §29.1 <3s）不为本
  // 面板付费；首次展开经 animate-os-fade-in 保持淡入观感，此后常挂不重放。
  const [panelEverExpanded, setPanelEverExpanded] = useState(false)
  if (panel.expanded && !panelEverExpanded) {
    setPanelEverExpanded(true)
  }

  const showDesktop = (): void => {
    for (const win of [...windows]) {
      if (win.state !== 'minimized') minimize(win.id)
    }
  }

  const railRef = useRef<HTMLElement | null>(null)
  // 液态玻璃（2026-10-02 裁决）随窄轨岛走：位移图按岛实测尺寸生成，
  // 展开过渡落定后重测（signal = expanded）。
  const liquidMap = useLiquidDisplacementMap(railRef, undefined, panel.expanded)
  const brandLabel = panel.expanded ? t('workspace.panel.collapse') : t('workspace.panel.expand')

  return (
    <>
      {/* 岛一：Workspace Rail——通高窄轨玻璃岛（§34 双岛口径：顶锚/收尾由
          组容器统一定，岛 h-full 撑满带高）。液态玻璃裁决仍由窄轨承担；
          不得挂 overflow（收起态气泡向右伸出，§26）。 */}
      <nav
        ref={railRef}
        aria-label={t('sidebar.label')}
        data-testid="sidebar"
        data-expanded={panel.expanded || undefined}
        className={`desktop-chrome pointer-events-auto surface-glass flex h-full w-[calc(var(--ag-rail-left-width)-0.5rem)] shrink-0 flex-col items-center gap-1 rounded-xl border border-border py-3 shadow-float ${
          liquidMap ? 'glass-liquid' : 'glass-raise'
        }`}
      >
        {/* 品牌钮 = 展开固定（pin）开关：键盘开合的可达入口。§34 参考图
            口径：实心渐变 squircle 徽章（--ag-capsule-active 同族明暗）。 */}
        <button
          type="button"
          data-testid="sidebar-brand"
          aria-expanded={panel.expanded}
          aria-controls="workspace-panel"
          aria-label={brandLabel}
          onClick={panel.togglePin}
          className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ag-capsule-active)] shadow-sm transition-transform hover:scale-[1.04] focus-visible:scale-[1.04]"
        >
          {/* Ageha Mark（§10 品牌主视觉）：装饰位，可访问名由按钮承载。 */}
          <BrandLogo size={26} />
          <span aria-hidden="true" className="os-tooltip">
            {brandLabel}
          </span>
        </button>
        <RailItem
          testid="sidebar-desktop"
          label={t('sidebar.desktop')}
          icon={Monitor}
          onClick={() => {
            showDesktop()
            panel.collapse()
          }}
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
        {/* 动作条目触发即收起面板：打开的窗口左缘控件不被 316px 面板遮盖
            （真实指针移出面板也会收起；这里让「点击即走」不依赖移出）。 */}
        <RailItem
          testid="sidebar-files"
          label={t('sidebar.files')}
          icon={FolderOpen}
          onClick={() => {
            launchApp('com.ageha.files')
            panel.collapse()
          }}
        />
        <RailItem
          testid="sidebar-notes"
          label={t('sidebar.notes')}
          icon={Notebook}
          onClick={() => {
            launchApp('com.ageha.notes')
            panel.collapse()
          }}
        />
        <RailItem
          testid="sidebar-terminal"
          label={t('sidebar.terminal')}
          icon={TerminalWindow}
          onClick={() => {
            launchApp('com.ageha.terminal')
            panel.collapse()
          }}
        />
        <RailItem
          testid="sidebar-settings"
          label={t('sidebar.settings')}
          icon={GearSix}
          onClick={() => {
            launchApp('com.ageha.settings')
            panel.collapse()
          }}
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
        {/* 收起手柄（§34 参考图：轨底分隔线 + 圆形手柄）——与品牌钮同一
            pin 开关（键盘可达的第二入口）；箭头指向随展开态翻转。可访问名
            独立于品牌钮（读屏可分辨两个入口）。 */}
        <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
          <span aria-hidden="true" className="h-px w-6 bg-border-subtle" />
          <button
            type="button"
            data-testid="sidebar-handle"
            aria-label={t(panel.expanded ? 'workspace.panel.handle.collapse' : 'workspace.panel.handle.expand')}
            onClick={panel.togglePin}
            className="group relative flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-raised hover:text-text focus-visible:bg-surface-raised focus-visible:text-text"
          >
            <CaretLeft
              size={13}
              weight="bold"
              aria-hidden="true"
              className={panel.expanded ? '' : 'rotate-180'}
            />
            <span aria-hidden="true" className="os-tooltip">
              {brandLabel}
            </span>
          </button>
        </div>
      </nav>
      {/* 岛二：Workspace Panel——独立玻璃卡（岛间 14px 缝隙由组容器 gap
          提供，缝隙穿透桌面）。首展才挂载（渲染期派生重置，React 官方模式，
          坑 4）：净桌面 reload 恢复预算（PRD §29.1 <3s）不为本面板付费；
          首展经 animate-os-fade-in 淡入，此后常挂——收起只是 0 宽 + 内容列
          inert，展开动画与滚动状态不丢。宽度过渡复用 motion Token：外层
          只做 0→316 裁剪揭示（幕帘），玻璃面/圆角/投影在内层定宽面上——
          收起态零边框投影残影，展开动画内容不回流。 */}
      {panelEverExpanded ? (
        <aside
          data-testid="workspace-panel-island"
          data-expanded={panel.expanded || undefined}
          className={`pointer-events-auto h-full animate-os-fade-in overflow-hidden transition-[width,opacity] [transition-duration:var(--ag-motion-base)] [transition-timing-function:var(--ag-motion-ease)] ${
            panel.expanded
              ? 'w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)] opacity-100'
              : 'w-0 opacity-0 pointer-events-none'
          }`}
        >
          <div
            data-testid="workspace-panel-surface"
            className="desktop-chrome surface-glass glass-raise h-full w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)] overflow-hidden rounded-xl border border-border shadow-float"
          >
            <WorkspacePanelBody expanded={panel.expanded} />
          </div>
        </aside>
      ) : null}
      {liquidMap && (
        <LiquidGlassDefs id="ag-liquid-rail" mapUri={liquidMap} options={{ strength: 10 }} />
      )}
    </>
  )
}
