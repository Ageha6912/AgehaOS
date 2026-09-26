import { useState } from 'react'

import { Sparkle } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { LAYOUT_PROTECTED_APP_IDS, pruneLayoutSuggestion } from '@/core/dynamic/layout/engine'
import { useAppStore } from '@/store/app-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

const PROTECTED_IDS = new Set(LAYOUT_PROTECTED_APP_IDS)

/** 采纳的布局档位 → 开始菜单宽度（§5.4 三档，离散不重叠）。 */
const TIER_WIDTH_CLASS: Record<string, string> = {
  single: 'w-56',
  double: 'w-[26rem]',
  grid: 'w-[30rem]',
}

export function AppLauncher() {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)
  const appliedLayout = useDynamicDesktopStore((s) => s.appliedLayout)
  const resetAppliedLayout = useDynamicDesktopStore((s) => s.resetAppliedLayout)

  const launch = (appId: string) => {
    launchApp(appId)
    setOpen(false)
  }

  // 采纳的布局裁剪到当前仍安装的成员（卸载/重装后不出现幽灵条目）。
  const layout = appliedLayout ? pruneLayoutSuggestion(appliedLayout, apps.map((app) => app.id)) : null
  const systemApps = layout ? apps.filter((app) => PROTECTED_IDS.has(app.id)) : []
  const groupedIds = new Set(layout?.groups.flatMap((group) => group.appIds) ?? [])
  const otherApps = layout
    ? apps.filter((app) => !PROTECTED_IDS.has(app.id) && !groupedIds.has(app.id))
    : []

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-text hover:bg-surface-raised"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">🦋</span>
        {t('taskbar.start')}
      </button>

      {open && !layout && (
        <menu
          aria-label={t('taskbar.start')}
          className="surface-glass animate-os-pop-in absolute bottom-10 left-0 z-50 w-56 rounded-lg border border-border p-1.5 shadow-window"
        >
          {apps.map((app) => (
            <LauncherItem key={app.id} appId={app.id} onLaunch={launch} />
          ))}
        </menu>
      )}

      {open && layout && (
        <menu
          aria-label={t('taskbar.start')}
          data-testid={`launcher-layout-${layout.tier}`}
          className={`surface-glass animate-os-pop-in absolute bottom-10 left-0 z-50 ${
            TIER_WIDTH_CLASS[layout.tier] ?? 'w-56'
          } rounded-lg border border-border p-1.5 shadow-window`}
        >
          {systemApps.length > 0 && (
            <li aria-label={t('dynamic.layout.systemGroup')}>
              <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {t('dynamic.layout.systemGroup')}
              </p>
              <ul aria-label={t('dynamic.layout.systemGroup')}>
                {systemApps.map((app) => (
                  <LauncherItem key={app.id} appId={app.id} onLaunch={launch} />
                ))}
              </ul>
            </li>
          )}
          {layout.groups.map((group) => (
            <li key={group.nameKey} aria-label={t(`dynamic.layout.group.${group.nameKey}` as MessageKey)}>
              <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">
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
          <li className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              data-testid="launcher-layout-reset"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface-raised hover:text-text"
              onClick={() => {
                resetAppliedLayout()
                setOpen(false)
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
