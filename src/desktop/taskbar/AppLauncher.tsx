import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  BookmarkSimple,
  Briefcase,
  CaretRight,
  ClockCounterClockwise,
  GameController,
  GearSix,
  MagnifyingGlass,
  Code,
  Sparkle,
  SquaresFour,
  Wrench,
  X,
} from '@phosphor-icons/react'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { shortcutLabel } from '@/core/platform'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName, launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { pruneLayoutSuggestion } from '@/core/dynamic/layout/engine'
import { useAppStore } from '@/store/app-store'
import { useUsageStore } from '@/store/usage-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { systemEclosion } from '@/services/eclosion'
import { filterLauncherAppIds } from './launcher-visibility'

/**
 * 启动器（docs/DESIGN.md §22 + §32 参考图对齐）：左侧锚定（贴左栏、Dock
 * 之上）的宽幅玻璃面板 = 顶部搜索（⌘K 徽标）+ 左侧分类轨（最近使用为默认，
 * 空最近回落全部应用）+ 右侧 4 列应用网格 + 推荐列表（最近使用驱动）。
 * 搜索跨全应用；Esc 关闭并回焦（§24）。采纳的布局建议改为排序 + 宽度档，
 * 重置入口在分类轨底部。
 *
 * 羽化动态分组（AI-GENERATED-APPS-DESIGN §6.4/§8，2026-10-02 落位裁决：
 * 桌面图标区已移除 → 启动器承载）：「今日」= 当日世界清单（世界行 hue 着色
 * 徽章，点击开窗即按需生成）；「我的羽化」=「获取」留存快照（跨重启可用，
 * 可卸载）。
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

/** 分类成员（静态映射，纯展示过滤；交集成员可归属多分类）。 */
const CATEGORY_MEMBERS: Record<
  Exclude<CategoryId, 'recent' | 'today' | 'eclosion-kept'>,
  readonly string[]
> = {
  system: ['com.ageha.files', 'com.ageha.store', 'com.ageha.settings', 'com.ageha.dynamic.panel'],
  dev: ['com.ageha.terminal'],
  office: ['com.ageha.notes', 'com.ageha.files'],
  fun: [
    'com.ageha.games.snake',
    'com.ageha.games.2048',
    'com.ageha.games.memory',
    'com.ageha.games.mines',
    'com.ageha.samples.sketch',
    'com.ageha.samples.clock',
  ],
  tools: [
    'com.ageha.calculator',
    'com.ageha.terminal',
    'com.ageha.samples.sticky',
    'com.ageha.samples.clock',
    // 羽化三件套（开关开且该应用为羽化版时才可见）。
    'com.ageha.eclosion.calculator',
    'com.ageha.eclosion.notes',
    'com.ageha.eclosion.clock',
  ],
  settings: ['com.ageha.settings'],
}

/** 采纳的布局档位 → 启动器宽度（§5.4 三档；§32 左锚定参考图比例 410px 档）。 */
const TIER_WIDTH_CLASS: Record<string, string> = {
  single: 'w-[410px]',
  double: 'w-[460px]',
  grid: 'w-[490px]',
}

export function AppLauncher() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryId>('recent')
  const menuPhase = useExitPhase(open)
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLMenuElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const closeMenu = (): void => {
    setOpen(false)
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
  // 打开即可输入：聚焦搜索框。
  useEffect(() => {
    if (open) searchRef.current?.focus()
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
  /** 分类成员：静态映射 + 动态域（今日世界清单 / 「获取」留存）。 */
  const categoryMembers = (id: CategoryId): readonly string[] => {
    if (id === 'today') {
      return world !== null ? world.apps.map((app) => `com.ageha.eclosion.${app.slug}`) : []
    }
    if (id === 'eclosion-kept') return keptAppIds
    if (id === 'recent') return [] // recent 分支在 gridAppIds 上层处理，不会走到
    return CATEGORY_MEMBERS[id]
  }
  const appliedLayout = useDynamicDesktopStore((s) => s.appliedLayout)
  const resetAppliedLayout = useDynamicDesktopStore((s) => s.resetAppliedLayout)
  const recent = useUsageStore((s) => s.recent)
  // 最近区（§22 P2-5）：只显示仍安装的应用，前 8。
  const recentApps = recent
    .map((entry) => apps.find((app) => app.id === entry.appId))
    .filter((app) => app !== undefined)
    .slice(0, 8)

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
  // （参考图形态：选中「最近使用」仍展示完整应用网格）；其余分类严格过滤。
  const layoutOrder = layout
    ? [
        ...layout.groups.flatMap((group) => group.appIds),
        ...apps.map((app) => app.id).filter((id) => !layout.groups.some((g) => g.appIds.includes(id))),
      ]
    : apps.map((app) => app.id)
  const recentIds = recentApps.map((app) => app.id)
  const gridAppIds =
    needle !== ''
      ? layoutOrder.filter(matches)
      : category === 'recent'
        ? [...recentIds, ...layoutOrder.filter((id) => !recentIds.includes(id))].filter(matches)
        : layoutOrder.filter((id) => categoryMembers(category).includes(id) && matches(id))

  // 推荐行：最近使用优先（排除当前网格已展示的前排），不足补布局建议。
  const recommendationIds = (() => {
    const base = recentApps.map((app) => app.id)
    if (base.length >= 3) return base.slice(0, 3)
    const extra = layoutOrder.filter((id) => !base.includes(id))
    return [...base, ...extra].slice(0, 3)
  })()

  const searchBox = (
    <div className="relative shrink-0 px-0.5 pb-2">
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
        onChange={(event) => setQuery(event.target.value)}
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

  const categoryRail = (
    <ul className="flex w-[116px] shrink-0 flex-col gap-0.5 border-r border-border-subtle pr-1.5">
      {(
        [
          { id: 'recent', labelKey: 'launcher.cat.recent', icon: ClockCounterClockwise },
          { id: 'today', labelKey: 'launcher.cat.today', icon: Sparkle },
          { id: 'system', labelKey: 'launcher.cat.system', icon: SquaresFour },
          { id: 'dev', labelKey: 'launcher.cat.dev', icon: Code },
          { id: 'office', labelKey: 'launcher.cat.office', icon: Briefcase },
          { id: 'fun', labelKey: 'launcher.cat.fun', icon: GameController },
          { id: 'tools', labelKey: 'launcher.cat.tools', icon: Wrench },
          { id: 'settings', labelKey: 'launcher.cat.settings', icon: GearSix },
          { id: 'eclosion-kept', labelKey: 'launcher.cat.kept', icon: BookmarkSimple },
        ] as Array<{ id: CategoryId; labelKey: MessageKey; icon: typeof Code }>
      ).map(({ id, labelKey, icon: Icon }) => (
        <li key={id}>
          <button
            type="button"
            data-testid={`launcher-category-${id}`}
            aria-pressed={category === id}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
              category === id
                ? 'bg-primary font-medium text-primary-contrast'
                : 'text-text-muted hover:bg-surface-raised hover:text-text'
            }`}
            onClick={() => {
              setCategory(id)
              setQuery('')
            }}
          >
            <Icon size={12} weight="fill" aria-hidden="true" />
            <span className="min-w-0 truncate">{t(labelKey)}</span>
          </button>
        </li>
      ))}
      {layout && (
        <li className="mt-auto">
          <button
            type="button"
            data-testid="launcher-layout-reset"
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] text-text-tertiary hover:bg-surface-raised hover:text-text"
            onClick={() => {
              resetAppliedLayout()
              closeMenu()
            }}
          >
            {t('dynamic.layout.reset')}
          </button>
        </li>
      )}
    </ul>
  )

  const emptyHint =
    gridAppIds.length === 0 ? (
      <p className="px-2 py-6 text-center text-xs text-text-muted">{t('search.empty')}</p>
    ) : null

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={t('taskbar.start')}
        title={t('taskbar.start')}
        className="flex h-12 w-12 items-center justify-center rounded-xl"
        onClick={() => setOpen((value) => !value)}
      >
        {/* 启动器瓷贴（§32 参考图 Launchpad 位）：浅底四宫格。 */}
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-[24%] bg-gradient-to-br from-[#e8f0ff] to-[#b9ccff] shadow-[0_1px_2px_rgba(15,23,42,0.25)] ring-1 ring-inset ring-white/40"
        >
          <SquaresFour size={20} weight="fill" color="#3b5bdb" />
        </span>
      </button>

      {/* §32 修订 8：弹层传送至 body——胶囊的 backdrop-filter 会成为 fixed
          弹层的包含块（坑 13 变体），窄视口下弹层随被钳制的胶囊偏移溢出；
          portal 到 body 后包含块恒为视口；Esc 走 usePopoverDismiss 的
          document 捕获监听（焦点在触发器上时也生效）。 */}
      {menuPhase.render &&
        createPortal(
          <menu
            ref={menuRef}
            aria-label={t('taskbar.start')}
            data-testid={layout ? `launcher-layout-${layout.tier}` : undefined}
            className={`popover-panel surface-glass fixed bottom-[calc(var(--ag-dock-height)+var(--ag-dock-gap)+0.75rem)] left-3 z-50 flex max-h-[calc(100vh-var(--ag-dock-height)-3rem)] flex-col overflow-hidden rounded-2xl p-3 sm:left-[calc(var(--ag-rail-left-width)+1.125rem)] ${
              TIER_WIDTH_CLASS[layout?.tier ?? 'single'] ?? 'w-[410px]'
            } max-w-[calc(100vw-1.5rem)] ${popoverMotionClass(menuPhase.exiting)}`}
          >
            {searchBox}
            <div className="flex min-h-0 flex-1 gap-2.5 overflow-y-auto scroll-thin">
              {categoryRail}
              <div className="min-w-0 flex-1">
                {emptyHint}
                {gridAppIds.length > 0 && (
                  <ul
                    className="grid grid-cols-4 gap-0.5"
                    data-testid={layout ? undefined : 'launcher-grid'}
                  >
                    {gridAppIds.map((appId) => (
                      <LauncherTile
                        key={appId}
                        appId={appId}
                        hue={worldHueByAppId.get(appId)}
                        onLaunch={launch}
                        removable={category === 'eclosion-kept'}
                        onRemove={
                          category === 'eclosion-kept'
                            ? (id) => void systemEclosion.unkeepApp(id)
                            : undefined
                        }
                        testId={
                          category === 'recent' &&
                          recentApps.some((app) => app.id === appId)
                            ? 'launcher-recent-item'
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                )}
                {!needle && gridAppIds.length > 0 && (
                  <div className="mt-2 border-t border-border-subtle pt-2">
                    <p className="px-1 pb-1 text-[11px] font-medium text-text-muted">
                      {t('launcher.recommend')}
                    </p>
                    <ul className="space-y-0.5">
                      {recommendationIds.map((appId) => (
                        <RecommendRow key={`rec-${appId}`} appId={appId} onLaunch={launch} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </menu>,
          document.body,
        )}
    </div>
  )
}

/** 图标瓦片（§22/§32 参考图 4 列网格）：AppIcon 44 + 11px 标签，点击启动。
 *  今日应用带世界行 hue 着色；「我的羽化」瓦片提供悬停卸载（§8 可卸载）。 */
function LauncherTile({
  appId,
  hue,
  onLaunch,
  removable,
  onRemove,
  testId,
}: {
  appId: string
  /** 世界行色相（今日应用；缺省确定性徽章）。 */
  hue?: number
  onLaunch: (appId: string) => void
  /** 「我的羽化」分组的卸载入口。 */
  removable?: boolean
  onRemove?: (appId: string) => void
  testId?: string
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
        className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-center hover:bg-surface-raised"
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

/** 推荐行（§32 参考图）：缩略徽章 + 名称 + 分类副标 + 右箭头，点击启动。 */
function RecommendRow({ appId, onLaunch }: { appId: string; onLaunch: (appId: string) => void }) {
  const { t } = useTranslation()
  const app = useAppStore((s) => s.apps.find((candidate) => candidate.id === appId))
  if (!app) return null
  const name = appDisplayName(app.id)
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-raised"
        onClick={() => onLaunch(app.id)}
      >
        <AppIcon appId={app.id} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-text">{name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-text-muted">
            {t('launcher.cat.recent')}
          </span>
        </span>
        <CaretRight size={12} weight="bold" aria-hidden="true" className="text-text-tertiary" />
      </button>
    </li>
  )
}
