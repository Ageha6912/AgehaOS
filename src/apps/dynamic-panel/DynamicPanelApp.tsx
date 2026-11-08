import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowClockwise, Sparkle } from '@phosphor-icons/react'

import { useNarrowContainer } from '@/apps/use-narrow-container'
import { useTranslation } from '@/core/i18n'

import { ScrollFadeList } from '@/components/scroll-fade-list'
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
import { fieldCompositionById } from '@/core/dynamic/generative/gradient-field'
import { banContent, getCachedAiSlots, requestAiSlots } from '@/core/dynamic/llm/client'
import { isRemoteAuthActive } from '@/core/auth/provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useAppStore } from '@/store/app-store'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useNotificationStore } from '@/store/notification-store'

/**
 * AI 内容面板（DDS §5.1 域③、§5.5，Phase B 本地切片）：
 * com.ageha.dynamic.panel，零权限注册；本地规则引擎组装卡片，打开时装配一次 +
 * 手动刷新（无自动定时刷新 → 窗口内容绝不热替换），每张卡带「AI 生成」标识；
 * 装配发 ai.content.ready / ai.decision.performed 事件（§3.3）。
 *
 * 窄容器适配（M3-5，use-narrow-container 契约）：根内容盒 <560px 时（移动
 * 全屏视图 / 桌面窄窗口）①单列化——容器宽档强制 grid-cols-1，min-[560px]
 * 双列档只在宽容器保留；②卡片内可点目标触控档 ≥44px（§35.3：刷新钮、布局
 * 采纳/重置、提示举报），文字同步抬档。宽容器 DOM 与改前字面等价；判定按
 * 容器宽、禁视口 media query，与设备判定（device-store）无关。
 */

const PANEL_ID = 'com.ageha.dynamic.panel'

/** 样本上传超时（D2 审查）：fetch 悬挂时确认框 busy 不再无限期挂住。 */
const SAMPLE_UPLOAD_TIMEOUT_MS = 15_000

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
  // 窄容器分支（M3-5）：观测应用根内容盒宽，与设备判定（device-store）
  // 无关——桌面窄窗口同样进入窄分支，移动宽视口保持宽布局。
  const { ref: rootRef, narrow } = useNarrowContainer()
  const [metas, setMetas] = useState<ContentCardMeta[]>([])
  const [layoutSuggestion, setLayoutSuggestionState] = useState<LayoutSuggestion | null>(null)
  const [assemblyNonce, setAssemblyNonce] = useState(0)
  /** LLM 增强：词典变体号（null=本地轮换）或过滤后的自由文本（Phase C）。 */
  const [enhancedTipId, setEnhancedTipId] = useState<string | null>(null)
  const [enhancedTipText, setEnhancedTipText] = useState<string | null>(null)
  const [enhanceSource, setEnhanceSource] = useState<'local' | 'llm' | 'cache'>('local')
  /** §8.6 样本上传：举报后待用户显式同意的内容文本（null = 无待同意样本）。 */
  const [pendingSample, setPendingSample] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const aliveRef = useRef(true)
  /** 装配代次（D2 审查）：快速连点刷新时，先发后返的 LLM 响应不得覆盖新装配。 */
  const assemblySeqRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const runAssembly = useCallback(() => {
    // 每次重装配推进代次：晚到的 LLM/缓存响应只允许落在发起它的那一轮。
    const seq = assemblySeqRef.current + 1
    assemblySeqRef.current = seq
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
              fieldId: dynamic.currentPlan.fieldId,
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
          // 代次 + 存活 + 应用前重读开关（D2 审查）：关闭 llmEnhance 后在途响应
          // 不再贴上；快速连点刷新时旧响应不得覆盖新装配。
          if (!aliveRef.current || assemblySeqRef.current !== seq) return false
          if (!useDynamicDesktopStore.getState().prefs.llmEnhance) return false
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

  // §8.6：仅在远程模式提供上传（纯本地模式没有可上传的服务端）；匿名上报，
  // 失败经通知中心透明告知。撤销/失败都不影响已完成的本机撤下。
  const submitSample = useCallback(async (text: string) => {
    setUploadBusy(true)
    // 悬挂的 fetch 不能无限期占住确认框（D2 审查）。
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SAMPLE_UPLOAD_TIMEOUT_MS)
    try {
      const response = await fetch('/api/dynamic/samples', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`sample-http-${response.status}`)
      setPendingSample(null)
    } catch {
      setPendingSample(null)
      useNotificationStore.getState().push({
        appId: PANEL_ID,
        titleKey: 'cards.tip.uploadFailedTitle',
        bodyKey: 'cards.tip.uploadFailedBody',
      })
    } finally {
      window.clearTimeout(timer)
      setUploadBusy(false)
    }
  }, [])

  // 卡片徽标来源（D2 审查）：tip 卡一旦用了 LLM/缓存增强，徽标必须如实显示
  // 来源；其余卡片（问候/壁纸/建议/布局）均由本地规则产出。
  const tipUsesEnhanced = enhancedTipText !== null || enhancedTipId !== null
  const cardSource = (kind: ContentCardMeta['card']['kind']): 'local' | 'llm' | 'cache' =>
    kind === 'tip' && tipUsesEnhanced ? enhanceSource : 'local'

  return (
    <div ref={rootRef} className="surface-panel flex h-full flex-col text-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text">
          <Sparkle size={16} weight="regular" />
          {t('cards.panel.title')}
        </h2>
        {/* 窄容器（移动全屏视图 / 小窗口）：刷新钮 44×44 触控档（§35.3）。
            宽容器（桌面）：类名与改前逐字一致。 */}
        <button
          type="button"
          aria-label={t('cards.panel.refresh')}
          title={t('cards.panel.refresh')}
          data-testid="dynamic-panel-refresh"
          className={`flex ${narrow ? 'h-11 w-11' : 'h-7 w-7'} items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-raised hover:text-text`}
          onClick={() => setAssemblyNonce((nonce) => nonce + 1)}
        >
          <ArrowClockwise size={narrow ? 16 : 13} weight="regular" />
        </button>
      </div>

      {/* 坑 44：滚动列表一律 ScrollFadeList（常驻细滚动条 + 底部渐隐双通道，
          修 §17 遗留的第 4 卡折叠线生裁）。外层 flex 列提供确定高度。
          §30 横版默认：宽容器（内容盒 ≥560px）保留 min-[560px] 双列档；
          窄容器（M3-5）容器宽档强制单列——媒体查询按视口算，窄分支按
          容器算（use-narrow-container 契约），移动全屏视图 / 桌面窄窗口
          恒单列。 */}
      <div className="flex min-h-0 flex-1 flex-col">
      <ScrollFadeList
        className={`grid grid-cols-1 content-start gap-2 p-3${narrow ? '' : ' min-[560px]:grid-cols-2'}`}
        testId="dynamic-panel-cards"
      >
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
            <p className="mt-1 text-[11px] text-text-muted">{t('dynamic.layout.hint')}</p>
            <div className="mt-2 flex items-center gap-2">
              {appliedId === layoutSuggestion.layoutId ? (
                <>
                  <span
                    className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-text"
                    data-testid="layout-applied-badge"
                  >
                    {t('dynamic.layout.applied')}
                  </span>
                  <button
                    type="button"
                    data-testid="layout-reset"
                    className={`rounded-md border border-border ${narrow ? 'min-h-[44px] px-3 py-1 text-xs' : 'px-2 py-1 text-[11px]'} text-text-muted hover:bg-surface-raised hover:text-text`}
                    onClick={() => resetAppliedLayout()}
                  >
                    {t('dynamic.layout.reset')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="layout-apply"
                  className={`rounded-md bg-primary ${narrow ? 'min-h-[44px] px-3 py-1 text-xs' : 'px-2 py-1 text-[11px]'} font-medium text-primary-contrast hover:opacity-90`}
                  onClick={() => applyLayout(layoutSuggestion)}
                >
                  {t('dynamic.layout.apply')}
                </button>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-text-muted">
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
                    const field =
                      meta.card.fieldId !== undefined
                        ? fieldCompositionById(meta.card.fieldId)
                        : undefined
                    return field === undefined ? null : (
                      <span data-testid="panel-wallpaper-photo">{t(field.nameKey)} · </span>
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
                      className={`${narrow ? 'mt-1 inline-flex min-h-[44px] items-center px-2 text-xs' : 'mt-1 text-[11px]'} text-text-muted underline hover:text-text`}
                      onClick={() => {
                        // §8.6：立即撤下 + 会话内封禁；上传仅在用户随后于
                        // 确认框中显式同意后发生（不经确认不上传）。
                        banContent(enhancedTipText ?? '')
                        setEnhancedTipText(null)
                        setEnhancedTipId(null)
                        setEnhanceSource('local')
                        systemBus.emit('ai.content.blocked', { panelId: PANEL_ID, reason: 'reported' })
                        if (isRemoteAuthActive()) setPendingSample(enhancedTipText ?? '')
                      }}
                    >
                      {t('cards.tip.report')}
                    </button>
                  )}
                </>
              )
            })()}
            <p className="mt-2 flex items-center gap-1 text-[11px] text-text-muted">
              <Sparkle size={10} weight="fill" className="text-primary" />
              {t('dynamicDesktop.badgeLabel')} · {t(SOURCE_KEYS[cardSource(meta.card.kind)])}
            </p>
          </li>
        ))}
      </ScrollFadeList>
      </div>

      {pendingSample !== null && (
        <ConfirmDialog
          title={t('cards.tip.reportDialog.title')}
          body={t('cards.tip.reportDialog.body')}
          confirmLabel={t('cards.tip.reportDialog.confirm')}
          cancelLabel={t('cards.tip.reportDialog.cancel')}
          busy={uploadBusy}
          onConfirm={() => void submitSample(pendingSample)}
          onCancel={() => setPendingSample(null)}
        />
      )}

      <p className="border-t border-border px-4 py-2 text-[11px] text-text-muted" data-testid="panel-decision-source">
        {t('cards.panel.decisionBy')} {t(SOURCE_KEYS[enhanceSource])}
      </p>
    </div>
  )
}
