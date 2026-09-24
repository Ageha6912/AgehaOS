import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowClockwise, Sparkle } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { systemBus } from '@/core/events'
import { buildContextSnapshot } from '@/core/dynamic/context/snapshot'
import {
  assembleContentCards,
  greetingBodyKey,
  greetingTitleKey,
  TIP_IDS,
  tipBodyKey,
} from '@/core/dynamic/content/engine'
import type { ContentCardMeta } from '@/core/dynamic/content/engine'
import { buildLayoutSuggestion } from '@/core/dynamic/layout/engine'
import type { LayoutSuggestion } from '@/core/dynamic/layout/engine'
import { photoById } from '@/core/dynamic/photos/catalog'
import { banContent, getCachedAiSlots, requestAiSlots } from '@/core/dynamic/llm/client'
import { useAppStore } from '@/store/app-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

/**
 * AI 内容面板（DDS §5.1 域③、§5.5，Phase B 本地切片）：
 * com.ageha.dynamic.panel，零权限注册；本地规则引擎组装卡片，打开时装配一次 +
 * 手动刷新（无自动定时刷新 → 窗口内容绝不热替换），每张卡带「AI 生成」标识；
 * 装配发 ai.content.ready / ai.decision.performed 事件（§3.3）。
 */

const PANEL_ID = 'com.ageha.dynamic.panel'

const SOURCE_KEYS: Record<'local' | 'llm' | 'cache', MessageKey> = {
  local: 'dynamicDesktop.source.local',
  llm: 'dynamicDesktop.source.llm',
  cache: 'dynamicDesktop.source.cache',
}

function themeOf(): 'light' | 'dark' {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark'
  }
  return 'light'
}

export function DynamicPanelApp() {
  const { t } = useTranslation()
  const [metas, setMetas] = useState<ContentCardMeta[]>([])
  const [layoutSuggestion, setLayoutSuggestionState] = useState<LayoutSuggestion | null>(null)
  const [assemblyNonce, setAssemblyNonce] = useState(0)
  /** LLM 增强：词典变体号（null=本地轮换）或过滤后的自由文本（Phase C）。 */
  const [enhancedTipId, setEnhancedTipId] = useState<string | null>(null)
  const [enhancedTipText, setEnhancedTipText] = useState<string | null>(null)
  const [enhanceSource, setEnhanceSource] = useState<'local' | 'llm' | 'cache'>('local')
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const runAssembly = useCallback(() => {
    // 全部本地信号（§2.1 白名单）：时间相/季节/主题 + 动态桌面状态 + 已安装应用。
    const dynamic = useDynamicDesktopStore.getState()
    const installed = useAppStore.getState().apps.map((app) => app.id)
    const snapshot = buildContextSnapshot({ now: new Date(), theme: themeOf(), tier: 'mid' })
    const result = assembleContentCards({
      snapshot,
      dynamicEnabled: dynamic.prefs.enabled,
      wallpaper:
        dynamic.prefs.enabled && dynamic.currentPlan
          ? {
              style: dynamic.currentPlan.style,
              level: dynamic.currentLevel,
              photoId: dynamic.currentPlan.photoId,
            }
          : null,
      installedAppIds: installed,
    })
    setMetas(result.cards)
    setEnhancedTipId(null)
    setEnhancedTipText(null)
    setEnhanceSource('local')
    // 布局建议（§5.1 域②）：仅在动态桌面开启时产出；AI 只建议，采纳靠用户。
    let suggestion: LayoutSuggestion | null = null
    if (dynamic.prefs.enabled) {
      suggestion = buildLayoutSuggestion({ snapshot, installedAppIds: installed })
      if (suggestion) {
        systemBus.emit('desktop.layout.suggested', { layoutId: suggestion.layoutId })
        systemBus.emit('ai.decision.performed', { domain: 'layout', source: 'local' })
      }
    }
    setLayoutSuggestionState(suggestion)
    useDynamicDesktopStore.getState().setLayoutSuggestion(suggestion)
    systemBus.emit('ai.content.ready', { panelId: PANEL_ID, itemCount: result.cards.length })
    systemBus.emit('ai.decision.performed', { domain: 'content', source: 'local' })

    // LLM 深度增强（§5.3）：异步叠加、绝不阻塞本地装配；失败链 = 缓存 → 本地。
    if (dynamic.prefs.enabled && dynamic.prefs.llmEnhance) {
      void (async () => {
        const applyTip = (text: string): boolean => {
          if (!aliveRef.current) return false
          if (TIP_IDS.includes(text as never)) {
            setEnhancedTipId(text)
            setEnhancedTipText(null)
          } else {
            setEnhancedTipId(null)
            setEnhancedTipText(text)
          }
          return true
        }
        try {
          const items = await requestAiSlots({
            locale: document.documentElement.lang === 'en' ? 'en' : 'zh-CN',
            context: { timePhase: snapshot.timePhase, season: snapshot.season },
            prefs: [],
            slots: ['tip'],
          })
          const tip = items.find((item) => item.slotId === 'tip')
          if (!tip || !applyTip(tip.text)) return
          setEnhanceSource('llm')
          systemBus.emit('ai.decision.performed', { domain: 'content', source: 'llm' })
        } catch {
          const cached = getCachedAiSlots().find((item) => item.slotId === 'tip')
          if (!cached || !applyTip(cached.text)) return
          setEnhanceSource('cache')
          systemBus.emit('ai.decision.performed', { domain: 'content', source: 'cache' })
        }
      })()
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(runAssembly, 0)
    return () => window.clearTimeout(timer)
  }, [assemblyNonce, runAssembly])

  const apps = useAppStore((s) => s.apps)
  const appliedLayout = useDynamicDesktopStore((s) => s.appliedLayout)
  const applyLayout = useDynamicDesktopStore((s) => s.applyLayout)
  const resetAppliedLayout = useDynamicDesktopStore((s) => s.resetAppliedLayout)
  const suggestAppTitle = (appId: string): string =>
    apps.find((app) => app.id === appId)?.name ?? appId

  const appliedId = appliedLayout?.layoutId ?? null

  return (
    <div className="flex h-full flex-col bg-surface text-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text">
          <Sparkle size={16} weight="regular" />
          {t('cards.panel.title')}
        </h2>
        <button
          type="button"
          aria-label={t('cards.panel.refresh')}
          title={t('cards.panel.refresh')}
          data-testid="dynamic-panel-refresh"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-raised hover:text-text"
          onClick={() => setAssemblyNonce((nonce) => nonce + 1)}
        >
          <ArrowClockwise size={13} weight="regular" />
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="dynamic-panel-cards">
        {layoutSuggestion && (
          <li
            className="rounded-lg border border-border bg-surface-raised/50 p-3"
            data-testid="panel-card-layout"
          >
            <p className="font-medium text-text">{t('dynamic.layout.cardTitle')}</p>
            <p className="mt-1 text-xs text-text-muted">
              {t(`dynamic.layout.tier.${layoutSuggestion.tier}` as MessageKey)} ·{' '}
              {layoutSuggestion.groups
                .map((group) => t(`dynamic.layout.group.${group.nameKey}` as MessageKey))
                .join(' / ')}
            </p>
            <p className="mt-1 text-[10px] text-text-muted">{t('dynamic.layout.hint')}</p>
            <div className="mt-2 flex items-center gap-2">
              {appliedId === layoutSuggestion.layoutId ? (
                <>
                  <span
                    className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-text"
                    data-testid="layout-applied-badge"
                  >
                    {t('dynamic.layout.applied')}
                  </span>
                  <button
                    type="button"
                    data-testid="layout-reset"
                    className="rounded-md border border-border px-2 py-1 text-[10px] text-text-muted hover:bg-surface-raised hover:text-text"
                    onClick={() => resetAppliedLayout()}
                  >
                    {t('dynamic.layout.reset')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="layout-apply"
                  className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-contrast hover:opacity-90"
                  onClick={() => applyLayout(layoutSuggestion)}
                >
                  {t('dynamic.layout.apply')}
                </button>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
              <Sparkle size={10} weight="fill" className="text-primary" />
              {t('dynamicDesktop.badgeLabel')} · {t('dynamicDesktop.source.local')}
            </p>
          </li>
        )}
        {metas.map((meta) => (
          <li
            key={meta.id}
            className="rounded-lg border border-border bg-surface-raised/50 p-3"
            data-testid={`panel-card-${meta.card.kind}`}
          >
            {meta.card.kind === 'greeting' && (
              <>
                <p className="font-medium text-text">{t(greetingTitleKey(meta.card.phase))}</p>
                <p className="mt-1 text-xs text-text-muted">{t(greetingBodyKey(meta.card.phase))}</p>
              </>
            )}
            {meta.card.kind === 'wallpaper' && (
              <>
                <p className="font-medium text-text">{t('cards.wallpaper.title')}</p>
                <p className="mt-1 text-xs text-text-muted">
                  {(() => {
                    const photo =
                      meta.card.photoId !== undefined ? photoById(meta.card.photoId) : undefined
                    return photo === null || photo === undefined ? null : (
                      <span data-testid="panel-wallpaper-photo">{t(photo.nameKey)} · </span>
                    )
                  })()}
                  {t(`dynamicDesktop.style.${meta.card.style}` as MessageKey)} ·{' '}
                  {t('dynamicDesktop.level')} {meta.card.level}
                </p>
              </>
            )}
            {meta.card.kind === 'suggest' && (
              <>
                <p className="font-medium text-text">{t('cards.suggest.title')}</p>
                <p className="mt-1 text-xs text-text-muted">
                  {meta.card.appIds.map((appId) => suggestAppTitle(appId)).join(' · ')}
                </p>
              </>
            )}
            {meta.card.kind === 'tip' && (() => {
              const isFreeText = enhancedTipText !== null
              const tipId =
                enhancedTipId !== null && TIP_IDS.includes(enhancedTipId as never)
                  ? enhancedTipId
                  : meta.card.tipId
              const bodyText = isFreeText ? (enhancedTipText ?? '') : t(tipBodyKey(tipId))
              return (
                <>
                  <p className="font-medium text-text">{t('cards.tip.title')}</p>
                  <p className="mt-1 text-xs text-text-muted" data-testid="panel-tip-body">
                    {bodyText}
                  </p>
                  {isFreeText && (
                    <button
                      type="button"
                      data-testid="panel-tip-report"
                      className="mt-1 text-[10px] text-text-muted underline hover:text-text"
                      onClick={() => {
                        // §8.6：立即撤下 + 会话内封禁；样本上传待基础设施（不经确认不上传）。
                        banContent(enhancedTipText ?? '')
                        setEnhancedTipText(null)
                        setEnhancedTipId(null)
                        setEnhanceSource('local')
                        systemBus.emit('ai.content.blocked', { panelId: PANEL_ID, reason: 'reported' })
                      }}
                    >
                      {t('cards.tip.report')}
                    </button>
                  )}
                </>
              )
            })()}
            <p className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
              <Sparkle size={10} weight="fill" className="text-primary" />
              {t('dynamicDesktop.badgeLabel')} · {t('dynamicDesktop.source.local')}
            </p>
          </li>
        ))}
      </ul>

      <p className="border-t border-border px-4 py-2 text-[10px] text-text-muted" data-testid="panel-decision-source">
        {t('cards.panel.decisionBy')} {t(SOURCE_KEYS[enhanceSource])}
      </p>
    </div>
  )
}
