import { useEffect, useMemo, useState } from 'react'

import { ArrowDown, CaretDown, Gauge, Globe, GlobeHemisphereEast, HardDrives } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { BrandLogo } from '@/components/brand-logo'
import { useTranslation } from '@/core/i18n'
import { useLocaleStore } from '@/core/i18n'
import { useClock } from '@/desktop/taskbar/use-clock'
import {
  notificationBodyText,
  notificationTitleText,
  unreadCount,
  useNotificationStore,
} from '@/store/notification-store'

/**
 * 右侧小组件栏（docs/DESIGN.md §27 + §32 参考图对齐）：四张浮卡 =
 * 时钟天气（含折叠月历）/ 系统状态（CPU·内存·网络）/ 最近通知（可清空）/
 * 品牌横幅。数据源全部真实（拒绝装饰性谎言）：时钟日历与时区走系统时间；
 * 系统状态走 performance memory / navigator.connection / rAF 实测帧率
 * （不可用显「—」）；通知走通知 store。≥1280px 显示（xl）。
 */
export function WidgetRail() {
  const { t } = useTranslation()

  return (
    <aside
      aria-label={t('widgets.label')}
      data-testid="widget-rail"
      className="desktop-chrome scroll-thin pointer-events-none fixed bottom-3 right-5 top-[calc(var(--ag-menubar-height)+1rem)] z-40 hidden w-[calc(var(--ag-rail-right-width)-0.5rem)] flex-col gap-4 overflow-y-auto pb-1 xl:flex"
    >
      <ClockCard />
      <SystemCard />
      <NotificationsCard />
      <BrandCard />
    </aside>
  )
}

const CARD_CLASS =
  'widget-card surface-glass pointer-events-auto rounded-2xl border border-border-subtle p-4 shadow-panel'

function ClockCard() {
  const locale = useLocaleStore((s) => s.locale)
  const clock = useClock()
  const { t } = useTranslation()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const now = new Date()
  const date = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(now)
  const timeZone = timeZoneLabel(now, locale)

  return (
    <section className={CARD_CLASS} data-testid="widgets-clock" aria-label={date}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* 等宽数据层（DESIGN.md §2.3）：时间戳是数据不是标题。 */}
          <p className="font-mono text-[32px] font-semibold leading-none tabular-nums text-text">
            {clock}
          </p>
          <button
            type="button"
            aria-expanded={calendarOpen}
            data-testid="widgets-clock-calendar-toggle"
            title={calendarOpen ? t('widgets.clock.collapseCalendar') : t('widgets.clock.expandCalendar')}
            className="mt-2.5 flex items-center gap-1 text-xs text-text-muted hover:text-text"
            onClick={() => setCalendarOpen((value) => !value)}
          >
            {date}
            <CaretDown
              size={10}
              weight="bold"
              className={`transition-transform ${calendarOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {timeZone && (
            <p
              data-testid="widgets-clock-timezone"
              className="mt-3.5 flex items-center gap-1.5 text-xs text-text-muted"
              title={t('widgets.clock.timezone')}
            >
              <GlobeHemisphereEast size={14} weight="fill" aria-hidden="true" />
              <span className="min-w-0 truncate">{timeZone}</span>
            </p>
          )}
        </div>
        <img
          src="/wallpapers/ageha-clock-thumb.jpg?v=5"
          alt=""
          data-testid="widgets-clock-thumb"
          className="h-[96px] w-[96px] shrink-0 rounded-xl object-cover shadow-soft"
        />
      </div>
      {calendarOpen && <MiniCalendar now={now} />}
    </section>
  )
}

/** 月历（原独立卡收拢进时钟卡 §32）：周一开头；今日主色圆角块。 */
function MiniCalendar({ now }: { now: Date }) {
  const locale = useLocaleStore((s) => s.locale)
  const year = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  // 周一开头：周一=0 … 周日=6。
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = now.getDate()

  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, index + 1)),
  )
  const title = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(now)

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]

  return (
    <div className="mt-3 border-t border-border-subtle pt-2.5" data-testid="widgets-calendar">
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
            className={`mx-auto flex h-5 w-5 items-center justify-center text-[11px] tabular-nums ${
              day === today
                ? 'rounded-full bg-primary font-semibold text-primary-contrast'
                : 'text-text-muted'
            }`}
          >
            {day ?? ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 本地时区的长名（如「中国标准时间」）；运行时不支持时返回空串不渲染。 */
function timeZoneLabel(now: Date, locale: string): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZoneName: 'long' })
      .formatToParts(now)
      .find((entry) => entry.type === 'timeZoneName')
    return part?.value ?? ''
  } catch {
    return ''
  }
}

/** 真实系统指标：内存（performance.memory）/ 网络（connection.downlink）/ 帧率（rAF 实测）。 */
function useSystemMetrics(): { fps: string; memory: string; downlink: string } {
  const [metrics, setMetrics] = useState({ fps: '—', memory: '—', downlink: '—' })

  const sample = useMemo(() => {
    const readMemory = (): string => {
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
      }
      if (!perf.memory) return '—'
      const ratio = perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit
      const percent = ratio * 100
      // <1% 保留一位小数（小堆开销不至于显示成 0%）。
      return `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`
    }
    const readDownlink = (): string => {
      const nav = navigator as Navigator & { connection?: { downlink?: number } }
      const downlink = nav.connection?.downlink
      if (downlink === undefined) return '—'
      return `${(downlink / 8).toFixed(1)} MB/s`
    }
    // 帧率：连续 60 帧的实测平均（原「CPU」是帧距抖动占比的估算，标成 CPU
    // 会误导，UI 评审 P1-4）。
    const readFps = (): Promise<string> =>
      new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
          resolve('—')
          return
        }
        let frames = 0
        let start: number | null = null
        const tick = (now: number): void => {
          if (start === null) start = now
          else frames += 1
          if (frames < 60) requestAnimationFrame(tick)
          else resolve(`${Math.round((frames * 1000) / Math.max(1, now - start))} fps`)
        }
        requestAnimationFrame(tick)
      })
    return { readMemory, readDownlink, readFps }
  }, [])

  useEffect(() => {
    let cancelled = false
    const update = (): void => {
      void sample.readFps().then((fps) => {
        if (!cancelled) setMetrics({ fps, memory: sample.readMemory(), downlink: sample.readDownlink() })
      })
    }
    update()
    const timer = window.setInterval(update, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sample])

  return metrics
}

function SystemCard() {
  const { t } = useTranslation()
  const metrics = useSystemMetrics()

  const cells = [
    {
      key: 'fps',
      label: t('widgets.system.fps'),
      hint: t('widgets.system.fpsHint'),
      icon: Gauge,
      value: metrics.fps,
    },
    { key: 'memory', label: t('widgets.system.memory'), hint: undefined, icon: HardDrives, value: metrics.memory },
    { key: 'network', label: t('widgets.system.network'), hint: undefined, icon: Globe, value: metrics.downlink },
  ] as const

  return (
    <section className={CARD_CLASS} data-testid="widgets-system">
      <p className="text-[13px] font-semibold text-text">{t('widgets.system')}</p>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        {cells.map(({ key, label, hint, icon: Icon, value }) => (
          <div
            key={key}
            data-testid={`widgets-system-${key}`}
            title={hint}
            className="rounded-xl bg-surface-soft px-1.5 py-2.5 text-center"
          >
            <p className="flex items-center justify-center gap-1 text-[11px] text-text-muted">
              <Icon size={11} weight="fill" aria-hidden="true" />
              {label}
            </p>
            {key === 'network' ? (
              <p className="mt-1 flex items-center justify-center gap-0.5 font-mono text-[11px] tabular-nums text-text">
                <ArrowDown size={8} weight="bold" aria-hidden="true" />
                {value}
              </p>
            ) : (
              <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-text">
                {value}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function NotificationsCard() {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const items = useNotificationStore((s) => s.items)
  const clear = useNotificationStore((s) => s.clear)
  const unread = unreadCount(items)
  // 最近 3 条（最新在前）；空态整卡保留（真实空态即「暂无通知」）。
  const recent = [...items].reverse().slice(0, 3)

  return (
    <section className={CARD_CLASS} data-testid="widgets-notifications">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-text">
          {t('widgets.recent')}
          {unread > 0 && <span className="ml-1.5 text-[11px] text-text-muted">{unread}</span>}
        </p>
        <button
          type="button"
          data-testid="widgets-notifications-clear"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text disabled:cursor-default disabled:text-text-disabled disabled:hover:bg-transparent"
          disabled={items.length === 0}
          onClick={clear}
        >
          {t('widgets.clearAll')}
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="mt-2 text-[11px] text-text-tertiary">{t('notification.empty')}</p>
      ) : (
        <ul className="mt-2.5 space-y-2.5">
          {recent.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <AppIcon appId={item.appId} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-text">
                    {notificationTitleText(item, t)}
                  </p>
                  <time className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
                    {new Intl.DateTimeFormat(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    }).format(new Date(item.createdAt))}
                  </time>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">
                  {notificationBodyText(item, t)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BrandCard() {
  const { t } = useTranslation()

  return (
    <section className={`${CARD_CLASS} flex items-center gap-3`} data-testid="widgets-brand">
      <BrandLogo size={26} />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text">{t('widgets.brand.title')}</p>
        <p className="mt-0.5 truncate text-[11px] text-text-muted">{t('widgets.brand.sub')}</p>
      </div>
    </section>
  )
}
