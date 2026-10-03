import { useRef, useState } from 'react'

import { Sparkle } from '@phosphor-icons/react'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { ScrollFadeList } from '@/components/scroll-fade-list'
import { useTranslation, formatMessage } from '@/core/i18n'
import { utcDayKey } from '@/core/eclosion/world'
import { useEclosionStore } from '@/store/eclosion-store'

/**
 * 顶栏「今日世界」小字（AI-GENERATED-APPS-DESIGN §6.3 透明性）：羽化开 + 当日
 * 世界在场时显示「今日桌面由 N 条趋势信号生成」，点击展开信号来源列表
 * （标题 + 来源链接）。弹层走 usePopoverDismiss 全局互斥（NotificationCenter
 * 同款；fixed 的包含块是菜单栏，坑 67——菜单栏贴视口顶部全宽，top/right
 * 等价于视口坐标）。纯想象降级（signalCount=0）无来源可列，不渲染。
 */
export function MenuBarWorldSignals() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const world = useEclosionStore((s) => s.world)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const phase = useExitPhase(open)

  usePopoverDismiss(
    'world-signals',
    open,
    (reason) => {
      const focusInside = panelRef.current?.contains(document.activeElement) ?? false
      setOpen(false)
      if (reason === 'escape' && focusInside) triggerRef.current?.focus()
    },
    { insideRefs: [wrapperRef] },
  )

  // 当日世界才称「今日」：跨日未换新（会话跨 UTC 零点）时隐藏，避免陈旧文案。
  if (!enabled || !world || world.worldDate !== utcDayKey() || world.signalCount === 0) {
    return null
  }

  return (
    <div ref={wrapperRef} className="flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="menubar-world-signals"
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text"
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkle size={12} weight="regular" aria-hidden="true" />
        <span>
          {formatMessage(t('menubar.worldSignals'), { count: String(world.signalCount) })}
        </span>
      </button>

      {phase.render && (
        <div
          ref={panelRef}
          role="region"
          aria-label={t('menubar.worldSignals.label')}
          data-testid="menubar-world-signals-panel"
          className={`popover-panel surface-glass fixed right-3 top-[calc(var(--ag-menubar-height)+0.5rem)] z-50 flex max-h-72 w-80 flex-col p-2 ${popoverMotionClass(phase.exiting)}`}
        >
          <p className="px-1 pb-2 text-xs font-semibold text-text">
            {t('menubar.worldSignals.label')}
          </p>
          <ScrollFadeList className="space-y-1" testId="menubar-world-signals-list">
            {world.signals.titles.map((title, index) => (
              <li
                key={`${index}-${title}`}
                data-testid="menubar-world-signal"
                className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-text"
              >
                {title}
              </li>
            ))}
          </ScrollFadeList>
          <div className="mt-2 border-t border-border-subtle px-1 pt-2">
            <p className="text-[11px] text-text-muted">
              {formatMessage(t('menubar.worldSignals.source'), { source: world.signals.sourceName })}
            </p>
            {world.signals.sourceUrl !== '' && (
              <a
                href={world.signals.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="menubar-world-signals-source-link"
                className="mt-0.5 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
              >
                {t('menubar.worldSignals.visitSource')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
