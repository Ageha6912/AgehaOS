import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { MagnifyingGlass, SquaresFour, X } from '@phosphor-icons/react'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { shortcutLabel } from '@/core/platform'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName, launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { pruneLayoutSuggestion } from '@/core/dynamic/layout/engine'
import {
  LAUNCHER_CATEGORY_MEMBERS,
  launcherWorkspaceScore,
  rankByScore,
  worldWorkspaceScore,
} from '@/desktop/workspace/affinity'
import { useAppStore } from '@/store/app-store'
import { useLauncherStore } from '@/store/launcher-store'
import { useUsageStore } from '@/store/usage-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { systemEclosion } from '@/services/eclosion'
import { consumeLauncherCategory } from './launcher-intent'
import { filterLauncherAppIds } from './launcher-visibility'
import { PINNED_APP_IDS } from './pinned-apps'

/**
 * 启动器（Desktop Shell 3.0 STEP 8 精修：居中 Ageha Application Launcher）：
 * 视口居中的大幅玻璃面板（宽 560-680 档，实现取 600），结构自上而下 =
 * Search → Recent → Pinned → Categories——弃左侧分类轨的 Windows 开始菜单
 * 形态，分类降为 Categories 区的芯片行（chip 行 + 6 列瓦片网格）。Recent
 * 只显示真实最近使用（usage-store，工作空间亲和稳定重排 = 推荐语义），
 * Pinned 与 Dock 常驻瓷贴消费同一份 PINNED_APP_IDS（pinned-apps.ts 单一
 * 来源）。搜索跨全应用（搜索态隐藏浏览区，结果即目标）；Esc 关闭并回焦
 * （§24）；键盘 ↑↓ 移动高亮、Enter 启动（与 Ctrl+K 搜索同一键盘模型）。
 *
 * 羽化动态分组（AI-GENERATED-APPS-DESIGN §6.4/§8）：「今日」= 当日世界
 * 清单（世界行 hue 着色徽章，点击开窗即按需生成）；「我的羽化」=「获取」
 * 留存快照（跨重启可用，可卸载）。可见性过滤 launcher-visibility.ts。
 */

type CategoryId =
  | 'recent'
  | 'today'
  | 'eclosion-kept'
  | 'system'
  | 'dev'
  | 'office'
  | 'fun'
  | 'tools'
  | 'settings'

/** Categories 芯片（Search → Recent → Pinned → Categories 末区；「最近使用」
 *  默认选中 = 最近置顶的全量网格，§22 形态）。 */
const LAUNCHER_CATEGORIES: ReadonlyArray<{ id: CategoryId; labelKey: MessageKey }> = [
  { id: 'recent', labelKey: 'launcher.cat.recent' },
  { id: 'today', labelKey: 'launcher.cat.today' },
  { id: 'system', labelKey: 'launcher.cat.system' },
  { id: 'dev', labelKey: 'launcher.cat.dev' },
  { id: 'office', labelKey: 'launcher.cat.office' },
  { id: 'fun', labelKey: 'launcher.cat.fun' },
  { id: 'tools', labelKey: 'launcher.cat.tools' },
  { id: 'settings', labelKey: 'launcher.cat.settings' },
  { id: 'eclosion-kept', labelKey: 'launcher.cat.kept' },
]

/** 分类成员（静态映射，纯展示过滤；交集成员可归属多分类）上收至
 * src/desktop/workspace/affinity.ts——Workspace Panel 的最近使用排序与
 * 本组件消费同一份映射，禁止第二套（Desktop Shell 3.0 STEP 2）。 */

/** 采纳的布局档位 → 启动器宽度（Shell 3.0 STEP 8 居中档 560-680px）。 */
const TIER_WIDTH_CLASS: Record<string, string> = {
  single: 'w-[600px]',
  double: 'w-[640px]',
  grid: 'w-[680px]',
}

/** Recent/Pinned 行展示上限（与 6 列网格同节奏，单行放得下）。 */
const QUICK_ROW_LIMIT = 6

export function AppLauncher() {
  // 开合入 store（Desktop Shell 3.0 STEP 1）：Dock 触发器与左侧 Workspace
  // Rail 的「启动器」项共享同一面板（notification-store.panelOpen 同模式）；
  // 搜索词/分类/键盘高亮仍是本组件的本地 UI 态。
  const open = useLauncherStore((s) => s.launcherOpen)
  const setLauncherOpen = useLauncherStore((s) => s.setLauncherOpen)
  const toggleLauncher = useLauncherStore((s) => s.toggleLauncher)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryId>('recent')
  const [activeIndex, setActiveIndex] = useState(0)
  const menuPhase = useExitPhase(open)
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLMenuElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const closeMenu = (): void => {
    setLauncherOpen(false)
    setQuery('')
  }
  // 弹层契约（§24 + UI 评审 P0-2）：Esc / 外部按下 / 被其他弹层顶替即关闭；
  // Esc 时焦点若在面板内则回焦触发器（portal 面板不在触发器子树内）。
  usePopoverDismiss(
    'launcher',
    open,
    (reason) => {
      const focusInside = menuRef.current?.contains(document.activeElement) ?? false
      closeMenu()
      if (reason === 'escape' && focusInside) triggerRef.current?.focus()
    },
    { insideRefs: [wrapperRef, menuRef] },
  )
  // 打开即可输入：聚焦搜索框并归零键盘高亮；外部入口的「打开即定位」意图
  // （Desktop Shell 3.0 STEP 3：Workspace Panel「查看世界」落「今日」分类）
  // 在打开瞬间消费——取走即清，未消费的普通打开维持上次的分类。
  useEffect(() => {
    if (!open) return
    const requested = consumeLauncherCategory()
    if (requested) {
      setQuery('')
      setCategory(requested)
    }
    setActiveIndex(0)
    searchRef.current?.focus()
  }, [open])
  const installedApps = useAppStore((s) => s.apps)
  const eclosionEnabled = useEclosionStore((s) => s.enabled)
  const eclosionModes = useEclosionStore((s) => s.modes)
  const world = useEclosionStore((s) => s.world)
  const keptAppIds = useEclosionStore((s) => s.keptAppIds)
  // 羽化呈现过滤（§2.1）：开关关 → 三件套隐藏（仅原生）；开且该应用选
  // 「羽化版」→ 三件套接管 calculator/notes 入口。渲染层过滤，不动注册表。
  const visibleAppIds = new Set(
    filterLauncherAppIds(installedApps.map((app) => app.id), {
      enabled: eclosionEnabled,
      modes: eclosionModes,
    }),
  )
  const apps = installedApps.filter((app) => visibleAppIds.has(app.id))
  // 今日世界行 hue → 瓦片徽章着色（§6.4：确定性徽章体系 + 色相旋转）。
  const worldHueByAppId = new Map<string, number>()
  if (world !== null) {
    for (const app of world.apps) {
      worldHueByAppId.set(`com.ageha.eclosion.${app.slug}`, app.hue)
    }
  }
  /** 分类成员：静态映射 + 动态域（今日世界清单 / 「获取」留存）。今日世界
   *  行按工作空间亲和稳定重排——同分保持世界生成序。 */
  const categoryMembers = (id: CategoryId): readonly string[] => {
    if (id === 'today') {
      if (world === null) return []
      const rows = world.apps
      return rankByScore(
        rows.map((app) => `com.ageha.eclosion.${app.slug}`),
        (appId) => {
          const slug = appId.replace('com.ageha.eclosion.', '')
          const row = rows.find((candidate) => candidate.slug === slug)
          return row ? worldWorkspaceScore(row.category, workspace) : 0
        },
      )
    }
    if (id === 'eclosion-kept') return keptAppIds
    if (id === 'recent') return [] // recent 分支在 gridAppIds 上层处理，不会走到
    return LAUNCHER_CATEGORY_MEMBERS[id]
  }
  const appliedLayout = useDynamicDesktopStore((s) => s.appliedLayout)
  const resetAppliedLayout = useDynamicDesktopStore((s) => s.resetAppliedLayout)
  const recent = useUsageStore((s) => s.recent)
  // 工作空间偏好（STEP 2）：只影响排序——最近区/今日世界按亲和稳定重排
  // （affinity.ts 纯函数），不增删任何应用。Recent 区即推荐语义：顺序真实
  // 响应 workspace selector（持久化，第 2 片落定）。
  const workspace = useWorkspaceStore((s) => s.workspace)
  // 最近区（§22 P2-5）：只显示仍安装的应用，亲和重排后取单行上限。
  const recentIds = rankByScore(
    recent
      .map((entry) => apps.find((app) => app.id === entry.appId))
      .filter((app) => app !== undefined)
      .map((app) => app.id),
    (id) => launcherWorkspaceScore(id, workspace),
  )
  const recentRowIds = recentIds.slice(0, QUICK_ROW_LIMIT)
  // 常驻区：与 Dock 瓷贴同一份清单（pinned-apps.ts），经羽化呈现过滤——
  // 被三件套接管的入口不出现（同一面板不出现两枚同名应用）。
  const pinnedRowIds = PINNED_APP_IDS.filter((id) => visibleAppIds.has(id))

  const launch = (appId: string) => {
    launchApp(appId)
    closeMenu()
  }

  // 本地过滤（§22）：按本地化名称匹配；清空输入即恢复全部。
  const needle = query.trim().toLowerCase()
  const matches = (appId: string): boolean => {
    if (!needle) return true
    return appDisplayName(appId).toLowerCase().includes(needle)
  }

  // 采纳的布局裁剪到当前仍安装的成员（卸载/重装后不出现幽灵条目）。
  const layout = appliedLayout ? pruneLayoutSuggestion(appliedLayout, apps.map((app) => app.id)) : null

  // 网格成员：搜索词优先跨全应用；最近使用分类 = 最近置顶的全量网格
  // （§22 形态：选中「最近使用」仍展示完整应用网格）；其余分类按成员序
  // 装配——今日世界的成员序经工作空间亲和重排（STEP 2），静态分类保持
  // 映射内声明序。
  const layoutOrder = layout
    ? [
        ...layout.groups.flatMap((group) => group.appIds),
        ...apps.map((app) => app.id).filter((id) => !layout.groups.some((g) => g.appIds.includes(id))),
      ]
    : apps.map((app) => app.id)
  const gridAppIds =
    needle !== ''
      ? layoutOrder.filter(matches)
      : category === 'recent'
        ? [...recentIds, ...layoutOrder.filter((id) => !recentIds.includes(id))].filter(matches)
        : categoryMembers(category).flatMap((id) =>
            layoutOrder.includes(id) && matches(id) ? [id] : [],
          )

  // 键盘导航（STEP 8 验收）：↑↓ 在可视顺序的扁平动作列表上移动高亮
  // （Recent 行 → Pinned 行 → Categories 网格；搜索态 = 结果网格），
  // Enter 启动当前项——与 Ctrl+K 搜索同一键盘模型（§23）。
  const actionIds = needle !== '' ? gridAppIds : [...recentRowIds, ...pinnedRowIds, ...gridAppIds]
  const clampedActive = Math.min(activeIndex, Math.max(actionIds.length - 1, 0))

  // 高亮项滚入可视区（跨分类切换/搜索切换后高亮归零，同样适用）。
  // jsdom 无 scrollIntoView：可选调用，真实浏览器才滚动。
  useEffect(() => {
    if (!open) return
    const el = menuRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [open, clampedActive, category, query])

  const moveActive = (delta: number): void => {
    setActiveIndex((index) =>
      Math.max(0, Math.min(index + delta, Math.max(actionIds.length - 1, 0))),
    )
  }

  const searchBox = (
    <div className="relative shrink-0 px-0.5 pb-3">
      <MagnifyingGlass
        size={14}
        weight="bold"
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <input
        ref={searchRef}
        type="text"
        data-testid="launcher-search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={(event) => {
          // Esc 不在此拦截：交给 usePopoverDismiss 的 document 捕获监听
          // （统一回焦触发器契约）。
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveActive(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveActive(-1)
          } else if (event.key === 'Enter') {
            const target = actionIds[clampedActive]
            if (target === undefined) return
            event.preventDefault()
            launch(target)
            triggerRef.current?.focus()
          }
        }}
        placeholder={t('launcher.searchPlaceholder')}
        aria-label={t('launcher.searchPlaceholder')}
        className="w-full rounded-lg border border-border-subtle bg-surface-elevated py-2 pl-8 pr-14 text-xs text-text placeholder:text-text-tertiary focus:outline-none"
      />
      <kbd
        aria-hidden="true"
        data-testid="launcher-search-kbd"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-border-subtle bg-surface-soft px-1.5 py-0.5 text-[11px] text-text-muted"
      >
        {shortcutLabel('K')}
      </kbd>
    </div>
  )

  const sectionLabel = (labelKey: MessageKey) => (
    <p className="px-1 pb-1 text-[11px] font-medium text-text-muted">{t(labelKey)}</p>
  )

  /** Recent / Pinned 快捷行（6 列单行瓦片；offset = 扁平键盘序的起点）。 */
  const quickRow = (
    labelKey: MessageKey,
    rowIds: readonly string[],
    offset: number,
    listTestId: string,
    itemTestId?: string,
  ) => {
    if (rowIds.length === 0) return null
    return (
      <section aria-label={t(labelKey)}>
        {sectionLabel(labelKey)}
        <ul className="grid grid-cols-6" data-testid={listTestId}>
          {rowIds.map((appId, index) => (
            <LauncherTile
              key={appId}
              appId={appId}
              hue={worldHueByAppId.get(appId)}
              active={offset + index === clampedActive}
              onHover={() => setActiveIndex(offset + index)}
              onLaunch={launch}
              testId={itemTestId}
            />
          ))}
        </ul>
      </section>
    )
  }

  const pinnedOffset = recentRowIds.length
  const gridOffset = pinnedOffset + pinnedRowIds.length

  const categoryChips = (
    <ul className="flex flex-wrap gap-1 pb-2.5">
      {LAUNCHER_CATEGORIES.map(({ id, labelKey }) => (
        <li key={id}>
          <button
            type="button"
            data-testid={`launcher-category-${id}`}
            aria-pressed={category === id}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              category === id
                ? 'bg-primary font-medium text-primary-contrast'
                : 'text-text-muted hover:bg-surface-raised hover:text-text'
            }`}
            onClick={() => {
              setCategory(id)
              setQuery('')
              setActiveIndex(0)
            }}
          >
            {t(labelKey)}
          </button>
        </li>
      ))}
    </ul>
  )

  const categoriesSection = (
    <section aria-label={t('launcher.section.categories')} className="border-t border-border-subtle pt-2.5">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-[11px] font-medium text-text-muted">{t('launcher.section.categories')}</p>
        {layout && (
          <button
            type="button"
            data-testid="launcher-layout-reset"
            className="rounded-md px-1.5 py-0.5 text-[11px] text-text-tertiary hover:bg-surface-raised hover:text-text"
            onClick={() => {
              resetAppliedLayout()
              closeMenu()
            }}
          >
            {t('dynamic.layout.reset')}
          </button>
        )}
      </div>
      {categoryChips}
      {gridAppIds.length > 0 ? (
        <ul
          key={category}
          className="grid animate-os-pop-in grid-cols-6 gap-0.5"
          data-testid={layout ? undefined : 'launcher-grid'}
        >
          {gridAppIds.map((appId, index) => (
            <LauncherTile
              key={appId}
              appId={appId}
              hue={worldHueByAppId.get(appId)}
              active={gridOffset + index === clampedActive}
              onHover={() => setActiveIndex(gridOffset + index)}
              onLaunch={launch}
              removable={category === 'eclosion-kept'}
              onRemove={
                category === 'eclosion-kept' ? (id) => void systemEclosion.unkeepApp(id) : undefined
              }
            />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-6 text-center text-xs text-text-muted">{t('search.empty')}</p>
      )}
    </section>
  )

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={t('taskbar.start')}
        title={t('taskbar.start')}
        className="flex h-12 w-12 items-center justify-center rounded-xl"
        onClick={() => toggleLauncher()}
      >
        {/* 启动器瓷贴（§32 参考图 Launchpad 位）：实底浅面 + 品牌强调字形
            （「大面=玻璃、小控件=实色」纪律，Token 语义化——STEP 8 收编散落
            hex 渐变）。 */}
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-[24%] bg-surface-elevated shadow-soft ring-1 ring-inset ring-border-subtle"
        >
          <SquaresFour size={20} weight="fill" className="text-primary" />
        </span>
      </button>

      {/* §32 修订 8 + STEP 8：弹层传送至 body（坑 13——胶囊 backdrop-filter
          会成为 fixed 弹层的包含块），包含块恒为视口；居中容器自身
          pointer-events-none（外部按下穿透到桌面并由 usePopoverDismiss 关闭），
          上下留出菜单栏/Dock 带再取视觉中心。Esc 走 usePopoverDismiss 的
          document 捕获监听（焦点在触发器上时也生效）。 */}
      {menuPhase.render &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center pb-[calc(var(--ag-dock-height)+var(--ag-dock-gap)+1.5rem)] pt-[calc(var(--ag-menubar-height)+1.5rem)]">
            <menu
              ref={menuRef}
              aria-label={t('taskbar.start')}
              data-testid={layout ? `launcher-layout-${layout.tier}` : undefined}
              className={`popover-panel surface-glass pointer-events-auto flex h-[min(520px,calc(100vh-13rem))] flex-col overflow-hidden p-4 ${
                TIER_WIDTH_CLASS[layout?.tier ?? 'single'] ?? 'w-[600px]'
              } max-w-[calc(100vw-1.5rem)] ${popoverMotionClass(menuPhase.exiting)}`}
            >
              {searchBox}
              <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
                {needle !== '' ? (
                  /* 搜索态：结果即目标，浏览区（Recent/Pinned/Categories）让位。 */
                  <div className="px-0.5">
                    {gridAppIds.length > 0 && (
                      <ul
                        className="grid grid-cols-6 gap-0.5"
                        data-testid={layout ? undefined : 'launcher-grid'}
                      >
                        {gridAppIds.map((appId, index) => (
                          <LauncherTile
                            key={appId}
                            appId={appId}
                            hue={worldHueByAppId.get(appId)}
                            active={index === clampedActive}
                            onHover={() => setActiveIndex(index)}
                            onLaunch={launch}
                          />
                        ))}
                      </ul>
                    )}
                    {gridAppIds.length === 0 && (
                      <p className="px-2 py-6 text-center text-xs text-text-muted">
                        {t('search.empty')}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 px-0.5">
                    {quickRow('launcher.recent', recentRowIds, 0, 'launcher-recent-list', 'launcher-recent-item')}
                    {quickRow('launcher.section.pinned', pinnedRowIds, pinnedOffset, 'launcher-pinned-list')}
                    {categoriesSection}
                  </div>
                )}
              </div>
            </menu>
          </div>,
          document.body,
        )}
    </div>
  )
}

/** 图标瓦片（4→6 列网格，STEP 8 居中宽幅）：AppIcon 44 + 11px 标签，点击
 *  启动；键盘高亮 = data-active + primary/10 底（Ctrl+K 同款），悬停同步
 *  高亮。今日应用带世界行 hue 着色；「我的羽化」瓦片提供悬停卸载（§8）。 */
function LauncherTile({
  appId,
  hue,
  onLaunch,
  removable,
  onRemove,
  testId,
  active,
  onHover,
}: {
  appId: string
  /** 世界行色相（今日应用；缺省确定性徽章）。 */
  hue?: number
  onLaunch: (appId: string) => void
  /** 「我的羽化」分组的卸载入口。 */
  removable?: boolean
  onRemove?: (appId: string) => void
  testId?: string
  /** 键盘/悬停共享的当前高亮（扁平动作序）。 */
  active?: boolean
  onHover?: () => void
}) {
  const { t } = useTranslation()
  const app = useAppStore((s) => s.apps.find((candidate) => candidate.id === appId))
  if (!app) return null
  const name = appDisplayName(app.id)
  return (
    <li className="group relative">
      <button
        type="button"
        title={name}
        data-testid={testId}
        data-active={active || undefined}
        onMouseEnter={onHover}
        className={`flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-center ${
          active ? 'bg-primary/10' : ''
        }`}
        onClick={() => onLaunch(app.id)}
      >
        <AppIcon appId={app.id} size={44} hue={hue} />
        <span className="w-full truncate text-[11px] text-text">{name}</span>
      </button>
      {removable && onRemove !== undefined && (
        <button
          type="button"
          data-testid={`launcher-unkeep-${appId}`}
          aria-label={`${t('launcher.unkeep')} · ${name}`}
          title={t('launcher.unkeep')}
          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-subtle bg-surface-raised text-text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => onRemove(app.id)}
        >
          <X size={10} weight="bold" aria-hidden="true" />
        </button>
      )}
    </li>
  )
}
