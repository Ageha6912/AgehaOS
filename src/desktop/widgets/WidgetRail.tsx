import { version } from '../../../package.json'

import { ArrowClockwise } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { useLocaleStore } from '@/core/i18n'
import { fieldCompositionById } from '@/core/dynamic/generative/gradient-field'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import { useClock } from '@/desktop/taskbar/use-clock'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useWindowStore } from '@/store/window-store'

/**
 * 右侧小组件栏（docs/DESIGN.md §27，Phase 2 P2-3）：权威图右侧竖列的
 * 「真实数据源」落地——时钟/日历/系统状态/今日壁纸四卡；天气/音乐/照片
 * 无数据源不建（拒绝装饰性谎言，Phase 1 §19 同口径）。
 * ≥1280px（Tailwind xl）显示；卡片形态克制（hairline 瓦片，非 SaaS 大白卡）。
 */
export function WidgetRail() {
  const { t } = useTranslation()

  return (
    <aside
      aria-label={t('widgets.label')}
      data-testid="widget-rail"
      className="scroll-thin surface-glass fixed bottom-0 right-0 top-[var(--ag-menubar-height)] z-40 hidden w-[var(--ag-rail-right-width)] flex-col gap-3 overflow-y-auto border-l border-border-subtle p-3 xl:flex"
    >
      <ClockCard />
      <CalendarCard />
      <SystemCard />
      <WallpaperCard />
    </aside>
  )
}

const CARD_CLASS = 'rounded-lg border border-border-subtle bg-surface-raised/50 p-3'

function ClockCard() {
  const locale = useLocaleStore((s) => s.locale)
  const clock = useClock()
  const date = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  return (
    <section className={CARD_CLASS} data-testid="widgets-clock" aria-label={date}>
      {/* 等宽数据层（DESIGN.md §2.3）：时间戳是数据不是标题。 */}
      <p className="font-mono text-2xl font-semibold tabular-nums text-text">{clock}</p>
      <p className="mt-1 text-xs text-text-muted">{date}</p>
    </section>
  )
}

/** 月历：周一开头六行网格；今日主色圆角块。纯日期数学，零外部数据。 */
function CalendarCard() {
  const locale = useLocaleStore((s) => s.locale)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  // 周一开头：周一=0 … 周日=6。
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = now.getDate()

  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(
      new Date(2024, 0, index + 1),
    ),
  )
  const title = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(now)

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]

  return (
    <section className={CARD_CLASS} data-testid="widgets-calendar" aria-label={title}>
      <p className="text-xs font-medium text-text">{title}</p>
      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {weekdayNames.map((name, index) => (
          <span
            key={`wd-${index}`}
            aria-hidden="true"
            className="text-[11px] font-medium text-text-tertiary"
          >
            {name}
          </span>
        ))}
        {cells.map((day, index) => (
          <span
            key={`d-${index}`}
            data-today={day === today ? 'true' : undefined}
            className={`mx-auto flex h-6 w-6 items-center justify-center text-[11px] tabular-nums ${
              day === today
                ? 'rounded-full bg-primary font-semibold text-primary-contrast'
                : 'text-text-muted'
            }`}
          >
            {day ?? ''}
          </span>
        ))}
      </div>
    </section>
  )
}

function SystemCard() {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const level = useDynamicDesktopStore((s) => s.currentLevel)
  const windows = useWindowStore((s) => s.windows)
  const items = useNotificationStore((s) => s.items)
  const unread = unreadCount(items)

  const rows: Array<[string, string]> = [
    [t('widgets.system.version'), `v${version}`],
    [t('widgets.system.locale'), locale],
    [t('widgets.system.tier'), level],
    [t('widgets.system.windows'), String(windows.length)],
    [t('widgets.system.notifications'), String(unread)],
  ]

  return (
    <section className={CARD_CLASS} data-testid="widgets-system">
      <p className="text-xs font-medium text-text">{t('widgets.system')}</p>
      <dl className="mt-2 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <dt className="text-[11px] text-text-muted">{label}</dt>
            <dd className="font-mono text-[11px] tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function WallpaperCard() {
  const { t } = useTranslation()
  const enabled = useDynamicDesktopStore((s) => s.prefs.enabled)
  const plan = useDynamicDesktopStore((s) => s.currentPlan)
  const field = plan?.fieldId !== undefined ? fieldCompositionById(plan.fieldId) : undefined

  return (
    <section className={CARD_CLASS} data-testid="widgets-wallpaper">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text">{t('widgets.wallpaper')}</p>
        {enabled && (
          <button
            type="button"
            aria-label={t('widgets.wallpaper.renew')}
            title={t('widgets.wallpaper.renew')}
            data-testid="widgets-wallpaper-renew"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
            onClick={() => void systemDynamicDesktop.refresh()}
          >
            <ArrowClockwise size={13} weight="regular" />
          </button>
        )}
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-text-muted">
        {enabled ? (field ? t(field.nameKey) : '—') : t('widgets.wallpaper.off')}
      </p>
    </section>
  )
}
