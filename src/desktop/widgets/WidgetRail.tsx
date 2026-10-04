import { useEffect, useMemo, useState } from 'react'

import {
  ArrowDown,
  CaretDown,
  CaretRight,
  Gauge,
  Globe,
  GlobeHemisphereEast,
  HardDrives,
  Sparkle,
} from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { formatMessage } from '@/core/i18n'
import { useTranslation } from '@/core/i18n'
import { useLocaleStore } from '@/core/i18n'
import { utcDayKey } from '@/core/eclosion/world'
import { useClock } from '@/desktop/taskbar/use-clock'
import { requestLauncherCategory } from '@/desktop/taskbar/launcher-intent'
import { useEclosionStore } from '@/store/eclosion-store'
import { useLauncherStore } from '@/store/launcher-store'
import {
  notificationBodyText,
  notificationTitleText,
  unreadCount,
  useNotificationStore,
} from '@/store/notification-store'

/**
 * 右侧 Floating System Center（Desktop Shell 3.0 STEP 4，docs/DESIGN.md §0.2
 * 材质表 + §33.2 右栏节奏）：四层漂浮层级 = 时钟日期 → 系统状态 → 最近通知 →
 * 今日世界（Dynamic/Explore）。容器不画材质、不再锚定底部（bottom 锚 +
 * overflow 滚动 = 贯穿全高的 Dashboard 侧栏，本切片退役）——高度由内容决定，
 * 仅当内容超出「顶锚 48px + 底部 Dock 区 88px」的剩余空间才兜底滚动。
 * 数据源全部真实（拒绝装饰性谎言 §0.5）：时钟日历与时区走系统时间（无天气行
 * ——没有真实天气数据源，不加假 API）；系统状态走 performance memory /
 * navigator.connection / rAF 实测帧率（不可用显「—」且不画进度条）；通知走
 * 通知 store，「查看更多」复用通知中心面板；今日世界走 eclosion-store 世界
 * 摘要（羽化关整卡不渲染，WorldSignals 同款门控）。≥1280px 显示（xl）。
 */
export function WidgetRail() {
  const { t } = useTranslation()

  return (
    <aside
      aria-label={t('widgets.label')}
      data-testid="widget-rail"
      className="desktop-chrome scroll-thin pointer-events-none fixed right-5 top-[calc(var(--ag-menubar-height)+1rem)] z-40 hidden max-h-[calc(100vh-var(--ag-menubar-height)-1rem-var(--ag-dock-height)-var(--ag-dock-gap))] w-[calc(var(--ag-rail-right-width)-0.5rem)] flex-col gap-4 overflow-y-auto xl:flex"
    >
      <ClockCard />
      <SystemCard />
      <NotificationsCard />
      <WorldCard />
    </aside>
  )
}

const CARD_CLASS =
  'widget-card surface-glass pointer-events-auto shrink-0 rounded-2xl border border-border-subtle p-4 shadow-panel'

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
      {/* 极简 OS 感（STEP 4）：大等宽时间 + 日期/时区次级行；壁纸缩略图退役
          （纯装饰图像，Dashboard 感来源之一；时间戳是数据不是标题 §2.3）。 */}
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
      {calendarOpen && <MiniCalendar now={now} />}
    </section>
  )
}

/** 月历（收拢进时钟卡 §32）：周一开头；今日主色圆角块。 */
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

/** 单项读数：显示文本 + 0..1 进度比（null = 数据源不可用，不画进度条）。 */
interface MetricReading {
  text: string
  ratio: number | null
}

/**
 * 真实系统指标：内存（performance.memory）/ 网络（connection.downlink）/
 * 帧率（rAF 实测）。进度比只来自测量值本身——帧率对 60fps 目标、内存对堆
 * 上限、网络对 Connection API 规范的 10Mbps downlink 满档（非发明刻度）；
 * 源不可用 = 「—」+ 无条（拒绝装饰性谎言 §0.5）。
 */
function useSystemMetrics(): { fps: MetricReading; memory: MetricReading; network: MetricReading } {
  const [metrics, setMetrics] = useState<{
    fps: MetricReading
    memory: MetricReading
    network: MetricReading
  }>({
    fps: { text: '—', ratio: null },
    memory: { text: '—', ratio: null },
    network: { text: '—', ratio: null },
  })

  const sample = useMemo(() => {
    const readMemory = (): MetricReading => {
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
      }
      if (!perf.memory) return { text: '—', ratio: null }
      const ratio = perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit
      const percent = ratio * 100
      // <1% 保留一位小数（小堆开销不至于显示成 0%）。
      return {
        text: `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`,
        ratio: Math.min(1, ratio),
      }
    }
    const readDownlink = (): MetricReading => {
      const nav = navigator as Navigator & { connection?: { downlink?: number } }
      const downlink = nav.connection?.downlink
      if (downlink === undefined) return { text: '—', ratio: null }
      return { text: `${(downlink / 8).toFixed(1)} MB/s`, ratio: Math.min(1, downlink / 10) }
    }
    // 帧率：连续 60 帧的实测平均（「流畅度」如实命名，不冒充 CPU——UI 评审 P1-4）。
    const readFps = (): Promise<MetricReading> =>
      new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'function') {
          resolve({ text: '—', ratio: null })
          return
        }
        let frames = 0
        let start: number | null = null
        const tick = (now: number): void => {
          if (start === null) start = now
          else frames += 1
          if (frames < 60) requestAnimationFrame(tick)
          else {
            const fps = Math.round((frames * 1000) / Math.max(1, now - start))
            // 60fps 为满条目标（fpsHint 同口径）；高刷屏封顶。
            resolve({ text: `${fps} fps`, ratio: Math.min(1, fps / 60) })
          }
        }
        requestAnimationFrame(tick)
      })
    return { readMemory, readDownlink, readFps }
  }, [])

  useEffect(() => {
    let cancelled = false
    const update = (): void => {
      void sample.readFps().then((fps) => {
        if (!cancelled) setMetrics({ fps, memory: sample.readMemory(), network: sample.readDownlink() })
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

/** 系统状态：行式 compact metrics——label 左 + 等宽数值右 + 行内细进度条。 */
function SystemCard() {
  const { t } = useTranslation()
  const metrics = useSystemMetrics()

  const rows = [
    {
      key: 'fps',
      label: t('widgets.system.fps'),
      hint: t('widgets.system.fpsHint'),
      icon: Gauge,
      reading: metrics.fps,
    },
    { key: 'memory', label: t('widgets.system.memory'), hint: undefined, icon: HardDrives, reading: metrics.memory },
    { key: 'network', label: t('widgets.system.network'), hint: undefined, icon: Globe, reading: metrics.network },
  ] as const

  return (
    <section className={CARD_CLASS} data-testid="widgets-system">
      <p className="text-[13px] font-semibold text-text">{t('widgets.system')}</p>
      {/* 进度条不铺满 widget（STEP 4 验收）：条是指标行内的次级元素（上下留
          行距、左右在卡 padding 内），不是卡片宽的仪表条——Dashboard 感来源。 */}
      <ul className="mt-2.5 space-y-2.5">
        {rows.map(({ key, label, hint, icon: Icon, reading }) => (
          <li key={key} data-testid={`widgets-system-${key}`} title={hint}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] text-text-muted">
                <Icon size={11} weight="fill" aria-hidden="true" />
                {label}
              </span>
              <span className="flex items-center gap-0.5 font-mono text-xs tabular-nums text-text">
                {key === 'network' && reading.text !== '—' && (
                  <ArrowDown size={8} weight="bold" aria-hidden="true" />
                )}
                {reading.text}
              </span>
            </div>
            {reading.ratio !== null && (
              <div
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-soft"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(reading.ratio * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function NotificationsCard() {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const items = useNotificationStore((s) => s.items)
  const clear = useNotificationStore((s) => s.clear)
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen)
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
        <>
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
          {/* 「查看更多」进入通知中心（STEP 4）：复用 panelOpen 槽（P2-2 同一
              面板，铃铛/左栏/此处三口共用），≥1280px 面板停靠右栏左侧不盖卡。 */}
          <button
            type="button"
            data-testid="widgets-notifications-more"
            className="mx-auto mt-2.5 flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text"
            onClick={() => setPanelOpen(true)}
          >
            {t('widgets.more')}
            <CaretRight size={9} weight="bold" aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  )
}

/**
 * 今日世界（STEP 4 第四层 Dynamic/Explore，替代原品牌横幅——中央品牌层与
 * Workspace Panel 品牌区已承载品牌，右栏静态横幅是 Dashboard 感残留）。数据
 * 零新取数：复用羽化编排器写入 eclosion-store 的世界摘要与 STEP 3 的
 * launcher-intent 一次性意图（打开启动器直达「今日」分类），禁止第二套实现：
 * - 羽化关（默认）→ 整卡不渲染（WorldSignals/STEP 3 同款门控；桌面保持安静）；
 * - 开但世界未落地（拉取中/503 静默降级）→ 安静空态，不渲染跳转钮
 *   （无数据可看时入口即死按钮，拒绝装饰性谎言）。
 */
function WorldCard() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const world = useEclosionStore((s) => s.world)
  const setLauncherOpen = useLauncherStore((s) => s.setLauncherOpen)

  if (!enabled) return null

  // 「今日已更新」以当日世界为准（会话跨 UTC 零点的陈旧摘要如实标注）。
  const fresh = world !== null && world.worldDate === utcDayKey()

  return (
    <section
      className={CARD_CLASS}
      data-testid="widgets-world"
      aria-label={t('workspace.panel.world')}
    >
      <p className="text-[13px] font-semibold text-text">{t('workspace.panel.world')}</p>
      {world === null ? (
        <p data-testid="widgets-world-empty" className="mt-2 text-[11px] leading-snug text-text-tertiary">
          {t('workspace.panel.world.empty')}
        </p>
      ) : (
        <button
          type="button"
          data-testid="widgets-world-entry"
          aria-label={`${t('workspace.panel.world.view')}：${world.headline}`}
          onClick={() => {
            requestLauncherCategory('today')
            setLauncherOpen(true)
          }}
          className="mt-1.5 flex w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-surface-raised"
        >
          <Sparkle size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-xs font-medium leading-snug text-text">
              {world.headline}
            </span>
            <span className="mt-1 block truncate text-[11px] leading-snug text-text-muted">
              {formatMessage(t('workspace.panel.world.apps'), { count: String(world.apps.length) })}
              {' · '}
              {t(fresh ? 'workspace.panel.world.fresh' : 'workspace.panel.world.stale')}
            </span>
          </span>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-[11px] font-medium text-primary">
            {t('workspace.panel.world.view')} →
          </span>
        </button>
      )}
    </section>
  )
}
