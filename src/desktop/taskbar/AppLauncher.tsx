import { useState } from 'react'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'

import { Sparkle } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { launchApp } from '@/apps/launch'
import { BrandLogo } from '@/components/brand-logo'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { LAYOUT_PROTECTED_APP_IDS, pruneLayoutSuggestion } from '@/core/dynamic/layout/engine'
import { useAppStore } from '@/store/app-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

const PROTECTED_IDS = new Set(LAYOUT_PROTECTED_APP_IDS)

/** 采纳的布局档位 → 启动器宽度（§5.4 三档，离散不重叠；§22 视觉升级调宽）。 */
const TIER_WIDTH_CLASS: Record<string, string> = {
  single: 'w-[24rem]',
  double: 'w-[30rem]',
  grid: 'w-[34rem]',
}

export function AppLauncher() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const menuPhase = useExitPhase(open)
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)
  const appliedLayout = useDynamicDesktopStore((s) => s.appliedLayout)
  const resetAppliedLayout = useDynamicDesktopStore((s) => s.resetAppliedLayout)

  const launch = (appId: string) => {
    launchApp(appId)
    setOpen(false)
    setQuery('')
  }

  // 本地过滤（§22）：按本地化名称匹配；清空输入即恢复全部。
  const needle = query.trim().toLowerCase()
  const matches = (appId: string): boolean => {
    if (!needle) return true
    const meta = componentFor(appId)
    const app = useAppStore.getState().apps.find((candidate) => candidate.id === appId)
    const name = meta ? t(meta.titleKey) : (app?.name ?? appId)
    return name.toLowerCase().includes(needle)
  }

  // 采纳的布局裁剪到当前仍安装的成员（卸载/重装后不出现幽灵条目）。
  const layout = appliedLayout ? pruneLayoutSuggestion(appliedLayout, apps.map((app) => app.id)) : null
  const systemApps = layout ? apps.filter((app) => PROTECTED_IDS.has(app.id) && matches(app.id)) : []
  const groupedIds = new Set(layout?.groups.flatMap((group) => group.appIds) ?? [])
  const otherApps = layout
    ? apps.filter((app) => !PROTECTED_IDS.has(app.id) && !groupedIds.has(app.id) && matches(app.id))
    : []
  const flatApps = layout ? [] : apps.filter((app) => matches(app.id))
  const visibleGroups = (layout?.groups ?? [])
    .map((group) => ({ ...group, appIds: group.appIds.filter(matches) }))
    .filter((group) => group.appIds.length > 0)
  const hasResults =
    systemApps.length > 0 || otherApps.length > 0 || flatApps.length > 0 || visibleGroups.length > 0

  const searchBox = (
    <li>
      <input
        type="text"
        data-testid="launcher-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('launcher.searchPlaceholder')}
        aria-label={t('launcher.searchPlaceholder')}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none"
      />
    </li>
  )

  const emptyRow = (
    <li className="px-2 py-6 text-center text-xs text-text-muted">{t('search.empty')}</li>
  )

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-12 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-text hover:bg-surface-raised"
        onClick={() => setOpen((value) => !value)}
      >
        <BrandLogo size={18} />
        {t('taskbar.start')}
      </button>

      {menuPhase.render && !layout && (
        <menu
          aria-label={t('taskbar.start')}
          className={`surface-glass absolute bottom-full left-0 mb-3 z-50 w-[24rem] rounded-xl border border-border p-2.5 shadow-window ${popoverMotionClass(menuPhase.exiting)}`}
        >
          {searchBox}
          {flatApps.length === 0 ? (
            emptyRow
          ) : (
            <li>
              {/* 图标优先的紧凑网格（§22）：AppIcon 明显、文字精简。 */}
              <ul className="grid grid-cols-4 gap-1">
                {flatApps.map((app) => (
                  <LauncherTile key={app.id} appId={app.id} onLaunch={launch} />
                ))}
              </ul>
            </li>
          )}
        </menu>
      )}

      {menuPhase.render && layout && (
        <menu
          aria-label={t('taskbar.start')}
          data-testid={`launcher-layout-${layout.tier}`}
          className={`surface-glass absolute bottom-full left-0 mb-3 z-50 ${
            TIER_WIDTH_CLASS[layout.tier] ?? 'w-[24rem]'
          } rounded-xl border border-border p-2.5 shadow-window ${popoverMotionClass(menuPhase.exiting)}`}
        >
          {searchBox}
          {!hasResults ? (
            emptyRow
          ) : (
            <>
              {systemApps.length > 0 && (
                <li aria-label={t('dynamic.layout.systemGroup')}>
                  <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                    {t('dynamic.layout.systemGroup')}
                  </p>
                  <ul aria-label={t('dynamic.layout.systemGroup')}>
                    {systemApps.map((app) => (
                      <LauncherItem key={app.id} appId={app.id} onLaunch={launch} />
                    ))}
                  </ul>
                </li>
              )}
              {visibleGroups.map((group) => (
                <li key={group.nameKey} aria-label={t(`dynamic.layout.group.${group.nameKey}` as MessageKey)}>
                  <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                    <Sparkle size={9} weight="fill" className="mr-1 inline" aria-hidden="true" />
                    {t(`dynamic.layout.group.${group.nameKey}` as MessageKey)}
                  </p>
                  <ul aria-label={t(`dynamic.layout.group.${group.nameKey}` as MessageKey)}>
                    {group.appIds.map((appId) => (
                      <LauncherItem key={appId} appId={appId} onLaunch={launch} />
                    ))}
                  </ul>
                </li>
              ))}
              {otherApps.length > 0 && (
                <li aria-label={t('dynamic.layout.systemGroup')}>
                  <ul aria-label={t('dynamic.layout.systemGroup')}>
                    {otherApps.map((app) => (
                      <LauncherItem key={app.id} appId={app.id} onLaunch={launch} />
                    ))}
                  </ul>
                </li>
              )}
            </>
          )}
          <li className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              data-testid="launcher-layout-reset"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface-raised hover:text-text"
              onClick={() => {
                resetAppliedLayout()
                setOpen(false)
                setQuery('')
              }}
            >
              {t('dynamic.layout.reset')}
            </button>
          </li>
        </menu>
      )}
    </div>
  )
}

/** 图标瓦片（§22 扁平形态）：AppIcon 40 + 11px 标签，点击启动。 */
function LauncherTile({ appId, onLaunch }: { appId: string; onLaunch: (appId: string) => void }) {
  const { t } = useTranslation()
  const app = useAppStore((s) => s.apps.find((candidate) => candidate.id === appId))
  if (!app) return null
  const meta = componentFor(app.id)
  const name = meta ? t(meta.titleKey) : app.name
  return (
    <li>
      <button
        type="button"
        title={name}
        className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-center hover:bg-surface-raised"
        onClick={() => onLaunch(app.id)}
      >
        <AppIcon appId={app.id} size={40} />
        <span className="w-full truncate text-[11px] text-text">{name}</span>
      </button>
    </li>
  )
}

function LauncherItem({ appId, onLaunch }: { appId: string; onLaunch: (appId: string) => void }) {
  const { t } = useTranslation()
  const app = useAppStore((s) => s.apps.find((candidate) => candidate.id === appId))
  if (!app) return null
  const meta = componentFor(app.id)
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-text hover:bg-surface-raised"
        onClick={() => onLaunch(app.id)}
      >
        <AppIcon appId={app.id} size={24} />
        {meta ? t(meta.titleKey) : app.name}
      </button>
    </li>
  )
}
