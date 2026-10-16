import { useEffect, useState, type ComponentType, type ReactNode } from 'react'

import {
  Bell,
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
import { utcDayKey } from '@/core/eclosion/world'
import { greetingTitleKey } from '@/core/dynamic/content/engine'
import { timePhaseOf } from '@/core/dynamic/generative/seed'
import { useTranslation, formatMessage } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { launcherWorkspaceScore, rankByScore } from '@/desktop/workspace/affinity'
import { applySpaceBindingPlan, planWorkspaceSpaceBinding } from '@/desktop/workspace/space-binding'
import type { WorkspacePanelController } from '@/desktop/workspace/use-workspace-panel'
import { DEFAULT_WALLPAPER_SRC } from '@/desktop/wallpaper/WallpaperLayer'
import { requestLauncherCategory } from '@/desktop/taskbar/launcher-intent'
import { useAppStore } from '@/store/app-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { useLauncherStore } from '@/store/launcher-store'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { useSpaceStore } from '@/store/space-store'
import { useUsageStore } from '@/store/usage-store'
import { useWindowStore } from '@/store/window-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import type { WorkspaceId } from '@/store/workspace-store'

/**
 * 左侧 Workspace Rail + Workspace Panel（Desktop Shell 3.0，§34 双岛口径）：
 * 窄轨与面板是**两座独立玻璃岛**——组容器（Desktop 的 system-rails）退化为
 * 纯定位层（顶锚菜单栏下方、Dock 上方收尾，pointer-events-none，岛间缝隙
 * 可穿透桌面）。窄轨毛玻璃 glass-raise 原档（2026-10-06 再裁决回归；当日
 * 「裸浮」试验 git c77275a 可溯）；面板 = 顶透下白渐变 veil + 磨砂带。
 * icon-first——40px 圆钮 + 20px 字形（44→40 换取 28px 呼吸档：720p 岛高
 * 576 预算内轨底手柄退役后的上限），可访问名由 aria-label 承载（自绘收起
 * 态气泡已退役 2026-10-06：hover/键盘聚焦任一路都立即展开面板，气泡在
 * 唯一能点亮的两态下都被 data-expanded 隐藏，属不可达死代码）；
 * hover/active/focus 一律轻 translucent capsule（chrome 作用域
 * surface-elevated 白玻璃，仅交互态出现），禁实心色块。
 * 展开（docs/DESIGN.md §34）：hover / click（品牌钮 pin）/ 键盘聚焦任一路
 * 触发 `data-expanded`，面板岛由 0 宽过渡到 304px（--ag-rail-left-expanded-
 * width 312 的内容档，纯浮层几何，窗口布局钳制仍钉 RAIL_LEFT_WIDTH_PX=80）。
 * 面板是连续
 * 的 Workspace Environment（不切成一堆 card）：品牌区（BrandLogo + 字标 +
 * 标语）→ 今日空间（真实日期 + 按当前用户问候，greeting 引擎 timePhase）→
 * 工作空间 selector（真实持久化，排序影响见 affinity.ts）→ 最近使用
 * （usage-store 真实数据）→ 底部垫今日世界品牌入口（复用 eclosion-store
 * 世界摘要 + 「查看世界」直达启动器「今日」分类，WorkspaceTodayWorld）。
 * 收起：鼠标离开（240ms 宽限）/ Esc / 面板外按下（pin 态）；展开态下条目
 * 名称常显。组容器与窄轨岛仍不得挂 overflow（§26 教训：越界浮层/焦点环
 * 防护，纪律保留）——面板岛自身的 overflow-hidden 只裁内容列。
 */

/** Rail 条目：裸图标浮于桌面（无常驻底座），交互态轻 capsule，可访问名走 aria-label。 */
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
      className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated active:bg-surface-elevated data-[active]:bg-surface-elevated"
    >
      <Icon size={20} weight="fill" aria-hidden="true" />
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
 * 今日世界分区（Desktop Shell 3.0 STEP 3 + 2026-10-05 常驻裁决）：AgehaOS
 * 独有的品牌入口，垫在面板底部（mt-auto 锚底 + hairline 分隔），**常驻**
 * ——参考图口径，不再随羽化开关消失。数据零新取数——复用羽化编排器写入
 * eclosion-store 的世界摘要（新应用数 = apps.length、趋势主题 = headline、
 * 今日更新状态 = worldDate 对 utcDayKey），禁止假数据：
 * - 羽化关 → 引导卡常驻：✦ 角标 + 「开启羽化，织出今日世界」，点击打开
 *   设置（真实动作，非死按钮）；
 * - 羽化开但世界未落地（拉取中/503 静默降级）→ 安静空态，不渲染跳转钮
 *   （无数据可看时「查看世界」即死按钮，拒绝装饰性谎言）；
 * - 世界已落地 → 摘要卡，「查看世界」= 打开启动器并直接落在「今日」分类
 *   （launcher-intent 一次性意图；面板收起走既有的弹层互斥，不在此重复
 *   收起逻辑）。
 */
function WorkspaceTodayWorld() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const world = useEclosionStore((s) => s.world)
  const setLauncherOpen = useLauncherStore((s) => s.setLauncherOpen)

  // 「今日已更新」以当日世界为准（会话跨 UTC 零点的陈旧摘要如实标注）。
  const fresh = world !== null && world.worldDate === utcDayKey()

  return (
    <section aria-label={t('workspace.panel.world')} className="mt-auto border-t border-border-subtle pt-2">
      <PanelHeading>{t('workspace.panel.world')}</PanelHeading>
      {!enabled ? (
        /* 羽化关：品牌入口常驻（参考图口径）——引导卡点击打开设置；
           陈旧 world 数据不展示（关了羽化的「查看世界」即准死按钮）。 */
        <button
          type="button"
          data-testid="workspace-world-entry"
          aria-label={t('workspace.panel.world.off')}
          onClick={() => launchApp('com.ageha.settings')}
          className="flex w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised px-2 py-2 text-left transition-colors hover:bg-surface-elevated"
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--ag-capsule-active)] shadow-sm"
          >
            <Sparkle size={18} weight="fill" className="text-primary-contrast" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-text">
            {t('workspace.panel.world.off')}
          </span>
          <CaretRight size={12} aria-hidden="true" className="shrink-0 text-primary" />
        </button>
      ) : world === null ? (
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg [background:var(--ag-capsule-active)] shadow-sm"
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
  // W8（审计 §11）：Space 映射所需的活跃真相 + 四档绑定表（随 store 响应式
  // 更新——MC/快捷键切 Space 时副指示圆点跟随移动）。
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const workspaceBindings = useSpaceStore((s) => s.workspaceBindings)
  const installedApps = useAppStore((s) => s.apps)
  const recent = useUsageStore((s) => s.recent)
  const now = useNow()

  // W8 selector 点击：先照旧激活 W 档（workspace-store 承担选中态，零改动），
  // 再按映射纯逻辑执行 Space 步骤——绑定存活直切；personal 首点收养
  // DEFAULT_SPACE_ID（不新播）；无绑定/死绑定走播种回落（createSpace→
  // bind→switch，评审建议 7）。
  const selectWorkspace = (id: WorkspaceId): void => {
    setWorkspace(id)
    const spaceState = useSpaceStore.getState()
    const plan = planWorkspaceSpaceBinding({
      workspace: id,
      bindings: spaceState.workspaceBindings,
      spaces: spaceState.spaces,
      activeSpaceId: spaceState.activeSpaceId,
    })
    applySpaceBindingPlan(plan, id, spaceState)
  }

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
      {/* Shell 3.1 F1：分区留白 gap-3 → gap-4——五个分区（品牌/今日空间/
          工作空间/最近/今日世界）留白均匀、分区感优先（标题仍 11px muted）。 */}
      <div className="flex w-full flex-col gap-4 px-3.5 pb-3 pt-3">
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
            {/* Shell 3.1 F1：黑遮罩 55% → 40%——照片细节比改前可见，日期/
                问候白字由 text-shadow（desktop-chrome）+ 白色高阶保持清晰。 */}
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
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
            Selected 配额内）。
            W8（审计 §11）：点击 = W 档激活（既有 setWorkspace 调用不动，
            workspace-store 零改动红线）+ Space 映射步骤（有绑定且存活直切，
            否则按需收养/播种并绑定）；绑定 Space === 活跃 Space 的档位显示
            Active 副指示小圆点（既有 capsule-active/border 族 token，无新
            token，主选中样式语义不变）。 */}
        <PanelSection label={t('workspace.panel.workspaces')} testid="workspaces">
          <div role="group" aria-label={t('workspace.panel.workspaces')} className="flex flex-col gap-1">
            {WORKSPACE_META.map(({ id, labelKey, icon: Icon }) => {
              const checked = workspace === id
              // 副指示只看 Space 真相（绑定 Space 是否活跃），与 W 档选中态
              // （aria-pressed）正交：MC/快捷键切 Space 也会移动圆点。
              const spaceActive = workspaceBindings[id] === activeSpaceId
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`workspace-option-${id}`}
                  aria-pressed={checked}
                  className={`flex h-9 items-center gap-2.5 rounded-xl px-2 text-left text-xs transition-colors ${
                    checked
                      ? /* Shell 3.1 F1：渐变胶囊保留（Active/Selected 配额内），shadow-sm 去除——选中靠主色胶囊本身，不靠投影。 */
                        '[background:var(--ag-capsule-active)] font-medium text-primary-contrast'
                      : 'text-text-muted hover:bg-surface-raised hover:text-text'
                  }`}
                  onClick={() => selectWorkspace(id)}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                      checked ? 'bg-white/20' : 'bg-surface-raised'
                    }`}
                  >
                    <Icon size={13} weight="fill" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 truncate">{t(labelKey)}</span>
                  {spaceActive && (
                    <span
                      aria-hidden="true"
                      data-testid={`workspace-space-dot-${id}`}
                      className="h-1.5 w-1.5 shrink-0 rounded-full border border-primary [background:var(--ag-capsule-active)]"
                    />
                  )}
                  <CaretRight size={11} aria-hidden="true" className="ml-auto shrink-0 opacity-70" />
                </button>
              )
            })}
          </div>
        </PanelSection>

        {/* 最近使用：真实 usage-store 数据；空态如实提示（拒绝装饰性谎言）。 */}
        <PanelSection label={t('workspace.panel.recent')} testid="recent">
          {recentApps.length > 0 ? (
            /* Shell 3.1 F1：最近行紧凑档——h-9→h-8、AppIcon 22→20、行尾
               箭头删除（减法：不许比工作空间区更抢眼，§11）。 */
            <ul className="flex flex-col gap-1">
              {recentApps.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    data-testid="workspace-recent-item"
                    onClick={() => launchApp(app.id)}
                    className="flex h-8 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-surface-raised"
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

  // Space-aware（W2，审计 .tmp/spaces-audit.md §5 决定 4）：「显示桌面」只
  // 最小化当前 Space 的可见窗口，其他 Space 不受波及。
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const showDesktop = (): void => {
    for (const win of [...windows]) {
      if (win.spaceId !== activeSpaceId) continue
      if (win.state !== 'minimized') minimize(win.id)
    }
  }

  // 玻璃分工（2026-10-06 再裁决：毛玻璃回归）：窄轨恢复 glass-raise
  // （blur 20）原档；面板 = glass-veil 顶透下白渐变（2%→12%，底部对齐
  // 右栏卡片白）+ panel-frost 全幅磨砂带同向渐隐。此前「窄轨裸浮」裁决
  // 仅存于历史（git c77275a 可溯）。液态折射玻璃退役不变（git cb6c404）。
  const brandLabel = panel.expanded ? t('workspace.panel.collapse') : t('workspace.panel.expand')

  return (
    <>
      {/* 岛一：Workspace Rail——通高窄轨毛玻璃岛（2026-10-06 再裁决：玻璃
          回归——glass-raise（blur 20）+ 边框 + 投影按原样恢复；28px 间隙、
          40px 圆钮、手柄退役等加隙裁决全部保持）。不得挂 overflow（§26
          纪律保留）。 */}
      <nav
        aria-label={t('sidebar.label')}
        data-testid="sidebar"
        data-expanded={panel.expanded || undefined}
        className="desktop-chrome pointer-events-auto surface-glass glass-raise flex h-full w-[calc(var(--ag-rail-left-width)-0.5rem)] shrink-0 flex-col items-center gap-[28px] rounded-xl border border-border py-4 shadow-float"
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
          className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [background:var(--ag-capsule-active)] shadow-sm transition-transform hover:scale-[1.04] focus-visible:scale-[1.04]"
        >
          {/* Ageha Mark（§10 品牌主视觉）：装饰位，可访问名由按钮承载。 */}
          <BrandLogo size={24} />
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
        {/* 动作条目触发即收起面板：打开的窗口左缘控件不被 304px 面板遮盖
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
        {/* 轨底分隔线 + 收起手柄已退役（2026-10-06 三连加隙裁决：gap 28px
            的 720p 预算要求；手柄与品牌钮同为 pin 开关属功能重复——键盘
            开合走品牌钮，收起路径还有 Esc / 面板外按下 / 鼠标离开宽限）。 */}
      </nav>
      {/* 岛二：Workspace Panel——独立玻璃卡（岛间 14px 缝隙由组容器 gap
          提供，缝隙穿透桌面）。首展才挂载（渲染期派生重置，React 官方模式，
          坑 4）：净桌面 reload 恢复预算（PRD §29.1 <3s）不为本面板付费；
          首展经 animate-os-fade-in 淡入，此后常挂——收起只是 0 宽 + 内容列
          inert，展开动画与滚动状态不丢。宽度过渡复用 motion Token：外层
          只做 0→304 裁剪揭示（幕帘），玻璃面/圆角/投影在内层定宽面上——
          收起态零边框投影残影，展开动画内容不回流。2026-10-06 用户裁决两连：
          F1 材质减重（glass-hint blur 12）之后**磨砂 backdrop 整体退出**——
          12px 磨砂在展开过渡结束才生效、整块读作乳白毛玻璃（用户感知
          「只有那一瞬间透明」的根因），现仅存 glass-veil 白纱 2.5% + 发丝级
          边框 border-subtle + panel 档轻投影定形，「漂浮在桌面上的一层纱」。 */}
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
            className="desktop-chrome panel-paper glass-veil relative h-full w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)] overflow-hidden rounded-xl border border-border-subtle shadow-panel"
          >
            {/* 全幅磨砂带（mask 顶透→底下全磨砂，与 veil 渐变同向——毛玻璃
                回归且顶部不白）；内容层随后（transform 建立堆叠上下文）
                绘制在带之上，面板自身文字不被磨砂波及。 */}
            <div
              aria-hidden="true"
              data-testid="workspace-panel-frost"
              className="panel-frost pointer-events-none absolute inset-0"
            />
            <WorkspacePanelBody expanded={panel.expanded} />
          </div>
        </aside>
      ) : null}
    </>
  )
}
