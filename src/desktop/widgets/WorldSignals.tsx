import { useRef, useState } from 'react'

import { createPortal } from 'react-dom'

import { ArrowClockwise } from '@phosphor-icons/react'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { ScrollFadeList } from '@/components/scroll-fade-list'
import { useTranslation, formatMessage } from '@/core/i18n'
import { utcDayKey } from '@/core/eclosion/world'
import { systemEclosion } from '@/services/eclosion'
import { useEclosionStore } from '@/store/eclosion-store'

/**
 * 右栏「今日世界」卡内的趋势信号区块（Shell 3.1 STEP 3，F3 顶栏信息减法：
 * 自 menu-bar/WorldSignals.tsx 原样迁入今日世界语境，AI-GENERATED-APPS-DESIGN
 * §6.3 透明性不变）：羽化开 + 当日世界在场 + signalCount>0 时，世界卡摘要行
 * 下渲染弱化信号行「由 N 条趋势信号织成 · 来源」，点击展开信号来源列表弹层
 * （标题 + 来源链接 + 「重新生成今日世界」——HANDOFF §2.5 指定的唯一重生成
 * 入口，功能随迁不丢）。
 *
 * 弹层契约（坑 13/26 家族）：WidgetRail 容器 overflow-y-auto 会裁剪并劫持
 * fixed 包含块——弹层 createPortal 至 body + 显式 bottom 定位（Dock 带上方、
 * 右缘对齐右栏 20px），向上生长完整落在视口内；usePopoverDismiss 槽名保持
 * 'world-signals'（DesktopBranding 的 brandingTier 经 popoverActive 感知，
 * 槽名即 branding 联动契约）；**弹层 portal 出 wrapper 后不在其 DOM 子树内，
 * insideRefs 必须单独传 panelRef**（use-popover-dismiss 注释明示），否则
 * 点击弹层内部会被判为「外部按下」误关。进退场动效（popoverMotionClass +
 * useExitPhase）原样随迁。门控：羽化关/世界 null/跨日陈旧/signalCount=0
 * 均不渲染信号行（与 WorldCard 的 enabled 外层门控合并成双保险）。
 */
export function WorldSignalsSection({
  onRegenerate,
}: {
  /** 测试注入；缺省走编排器单例（POST /world/regenerate，耗 today 档）。 */
  onRegenerate?: () => Promise<boolean>
} = {}) {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const world = useEclosionStore((s) => s.world)
  const [open, setOpen] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateFailed, setRegenerateFailed] = useState(false)
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
    // portal 面板不在 wrapper 子树内：内部区域 = 触发行 wrapper + 弹层本体。
    { insideRefs: [wrapperRef, panelRef] },
  )

  // 当日世界才称「今日」：跨日未换新（会话跨 UTC 零点）时隐藏，避免陈旧文案。
  if (!enabled || !world || world.worldDate !== utcDayKey() || world.signalCount === 0) {
    return null
  }

  const regenerate = (): void => {
    if (regenerating) return
    setRegenerating(true)
    setRegenerateFailed(false)
    void (onRegenerate ?? (() => systemEclosion.regenerateWorld()))().then((ok) => {
      setRegenerating(false)
      // 成功时 store 已换新（applyWorld 响应式刷新列表与文案）；失败给出页内提示。
      setRegenerateFailed(!ok)
      if (!ok) window.setTimeout(() => setRegenerateFailed(false), 4000)
    })
  }

  return (
    <div ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="widgets-world-signals"
        className="mt-0.5 flex w-full items-center rounded-md px-1 py-0.5 text-left text-[11px] text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 truncate">
          {formatMessage(t('widgets.world.signals'), { count: String(world.signalCount) })}
        </span>
      </button>

      {phase.render &&
        createPortal(
          <div
            ref={panelRef}
            role="region"
            aria-label={t('widgets.world.signals.label')}
            data-testid="widgets-world-signals-panel"
            className={`popover-panel surface-glass fixed bottom-[calc(var(--ag-dock-height)+var(--ag-dock-gap)+0.75rem)] right-5 z-50 flex max-h-72 w-80 flex-col p-2 ${popoverMotionClass(phase.exiting)}`}
          >
            <p className="px-1 pb-2 text-xs font-semibold text-text">
              {t('widgets.world.signals.label')}
            </p>
            {/* 列表区必须定高（bb010b8 通知中心同款先例）：ScrollFadeList 的
                ul 绝对铺满包装层（固有高度 0），父弹层只有 max-h-72 没有确定
                高度时 flex-1 无自由空间可分——列表塌缩（QA low 遗留，原顶栏
                弹层同款；Shell 3.1 STEP 3 弹层展开态截图验收暴露后按既有
                定高模式修复）。条目多时列表内部滚动 + 底缘渐隐。 */}
            <div className="flex h-28 flex-col">
              <ScrollFadeList className="space-y-1" testId="widgets-world-signals-list">
                {world.signals.titles.map((title, index) => (
                  <li
                    key={`${index}-${title}`}
                    data-testid="widgets-world-signal"
                    className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-text"
                  >
                    {title}
                  </li>
                ))}
              </ScrollFadeList>
            </div>
            <div className="mt-2 border-t border-border-subtle px-1 pt-2">
              <p className="text-[11px] text-text-muted">
                {formatMessage(t('widgets.world.signals.source'), {
                  source: world.signals.sourceName,
                })}
              </p>
              {world.signals.sourceUrl !== '' && (
                <a
                  href={world.signals.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="widgets-world-signals-source-link"
                  className="mt-0.5 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
                >
                  {t('widgets.world.signals.visitSource')}
                </a>
              )}
            </div>
            <div className="mt-2 border-t border-border-subtle px-1 pt-2">
              <button
                type="button"
                data-testid="widgets-world-regenerate"
                disabled={regenerating}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-text hover:bg-surface-raised disabled:cursor-default disabled:opacity-50"
                onClick={regenerate}
              >
                <ArrowClockwise size={12} weight="regular" aria-hidden="true" />
                {regenerating
                  ? t('widgets.world.signals.regenerating')
                  : t('widgets.world.signals.regenerate')}
              </button>
              {regenerateFailed && (
                <p
                  data-testid="widgets-world-regenerate-failed"
                  className="mt-1 text-[11px] text-danger"
                >
                  {t('widgets.world.signals.regenerateFailed')}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
