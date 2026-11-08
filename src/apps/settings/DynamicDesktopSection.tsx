import { useState } from 'react'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { sliderBand } from '@/core/dynamic/decision/engine'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ToggleSwitch } from '@/components/toggle-switch'

/** Settings「动态桌面」section（设计文档 §6.5 入口 ①）：总开关、滑杆、固定/屏蔽、历史、清除数据。 */

const BAND_LABEL_KEYS: Record<string, MessageKey> = {
  fixed: 'dynamicDesktop.band.fixed',
  fine: 'dynamicDesktop.band.fine',
  balanced: 'dynamicDesktop.band.balanced',
  explore: 'dynamicDesktop.band.explore',
  wild: 'dynamicDesktop.band.wild',
}

const SIGNAL_KIND_KEYS: Record<string, MessageKey> = {
  time: 'dynamicDesktop.signal.time',
  theme: 'dynamicDesktop.signal.theme',
  season: 'dynamicDesktop.signal.season',
  stage: 'dynamicDesktop.signal.stage',
  band: 'dynamicDesktop.signal.band',
  fallback: 'dynamicDesktop.signal.fallback',
}

const SIGNAL_VALUE_KEYS: Record<string, Record<string, MessageKey>> = {
  time: {
    morning: 'dynamicDesktop.value.time.morning',
    day: 'dynamicDesktop.value.time.day',
    evening: 'dynamicDesktop.value.time.evening',
    night: 'dynamicDesktop.value.time.night',
  },
  theme: { light: 'dynamicDesktop.value.theme.light', dark: 'dynamicDesktop.value.theme.dark' },
  season: {
    spring: 'dynamicDesktop.value.season.spring',
    summer: 'dynamicDesktop.value.season.summer',
    autumn: 'dynamicDesktop.value.season.autumn',
    winter: 'dynamicDesktop.value.season.winter',
  },
  stage: {
    'cold-start': 'dynamicDesktop.value.stage.cold-start',
    exploration: 'dynamicDesktop.value.stage.exploration',
    convergence: 'dynamicDesktop.value.stage.convergence',
    steady: 'dynamicDesktop.value.stage.steady',
    pinned: 'dynamicDesktop.value.stage.pinned',
  },
  band: BAND_LABEL_KEYS,
  fallback: {
    'static-gradient': 'dynamicDesktop.value.fallback.static-gradient',
    curated: 'dynamicDesktop.value.curated',
  },
}

const SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  local: 'dynamicDesktop.source.local',
  cache: 'dynamicDesktop.source.cache',
  llm: 'dynamicDesktop.source.llm',
}

export function DynamicDesktopSection() {
  const { t } = useTranslation()
  const prefs = useDynamicDesktopStore((s) => s.prefs)
  const currentPlan = useDynamicDesktopStore((s) => s.currentPlan)
  const currentLevel = useDynamicDesktopStore((s) => s.currentLevel)
  const lastDecisionSource = useDynamicDesktopStore((s) => s.lastDecisionSource)
  const generating = useDynamicDesktopStore((s) => s.generating)
  const history = useDynamicDesktopStore((s) => s.history)
  const setEnabled = useDynamicDesktopStore((s) => s.setEnabled)
  const setLlmEnhance = useDynamicDesktopStore((s) => s.setLlmEnhance)
  const setRandomness = useDynamicDesktopStore((s) => s.setRandomness)
  const setHideBadge = useDynamicDesktopStore((s) => s.setHideBadge)
  const pinCurrent = useDynamicDesktopStore((s) => s.pinCurrent)
  const unpin = useDynamicDesktopStore((s) => s.unpin)
  const blockCurrentStyle = useDynamicDesktopStore((s) => s.blockCurrentStyle)
  const rollbackTo = useDynamicDesktopStore((s) => s.rollbackTo)
  // 「清除全部数据」不可逆：二次确认 + 在途禁用（D2 审查：此前单击即执行）。
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  const band = sliderBand(prefs.randomness)

  const clearAll = async (): Promise<void> => {
    setClearing(true)
    try {
      await systemDynamicDesktop.clearAllData()
      setClearOpen(false)
    } finally {
      setClearing(false)
    }
  }

  return (
    <section aria-label={t('dynamicDesktop.section')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('dynamicDesktop.section')}</h2>

      <div className="mb-5">
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={prefs.enabled}
            label={t('dynamicDesktop.enable')}
            testId="dynamic-desktop-toggle"
            onClick={() => {
              setEnabled(!prefs.enabled)
              if (!prefs.enabled) void systemDynamicDesktop.refresh()
            }}
          />
          <span className="text-xs text-text">{t('dynamicDesktop.enable')}</span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{t('dynamicDesktop.enableHint')}</p>
      </div>

      <div className="mb-5">
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={prefs.llmEnhance}
            label={t('dynamicDesktop.llmEnhance')}
            testId="llm-enhance-toggle"
            disabled={!prefs.enabled}
            onClick={() => setLlmEnhance(!prefs.llmEnhance)}
          />
          <span className={`text-xs ${prefs.enabled ? 'text-text' : 'text-text-muted/60'}`}>
            {t('dynamicDesktop.llmEnhance')}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{t('dynamicDesktop.llmEnhanceHint')}</p>
      </div>

      <div className="mb-5">
        <label htmlFor="dynamic-desktop-randomness" className="mb-1 block text-xs text-text-muted">
          {t('dynamicDesktop.randomness')} · {t(BAND_LABEL_KEYS[band.band])}
        </label>
        <input
          id="dynamic-desktop-randomness"
          type="range"
          min={0}
          max={100}
          step={1}
          value={prefs.randomness}
          onChange={(event) => setRandomness(Number(event.target.value))}
          className="w-full max-w-xs accent-[var(--ag-primary)]"
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="dynamic-desktop-refresh"
          disabled={generating || !prefs.enabled || prefs.pinned !== null}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void systemDynamicDesktop.refresh()}
        >
          {t('dynamicDesktop.refresh')}
        </button>
        {prefs.pinned ? (
          <button
            type="button"
            data-testid="dynamic-desktop-unpin"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
            onClick={unpin}
          >
            {t('dynamicDesktop.unpin')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="dynamic-desktop-pin"
            disabled={currentPlan === null}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            onClick={pinCurrent}
          >
            {t('dynamicDesktop.pin')}
          </button>
        )}
        <button
          type="button"
          data-testid="dynamic-desktop-block"
          disabled={currentPlan === null || prefs.blockedStyles.includes(currentPlan.style)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          onClick={blockCurrentStyle}
        >
          {t('dynamicDesktop.blockStyle')}
        </button>
      </div>

      <div className="mb-5 rounded-md border border-border bg-surface-raised/50 p-3 text-xs text-text-muted">
        <p className="mb-1 text-text">{t('dynamicDesktop.current')}</p>
        {currentPlan ? (
          <ul className="space-y-0.5">
            <li>
              {t('dynamicDesktop.currentStyle')}:{' '}
              {t(`dynamicDesktop.style.${currentPlan.style}` as 'dynamicDesktop.style.fluid-gradient')}
              {prefs.pinned ? ` · ${t('dynamicDesktop.pinnedTag')}` : ''}
            </li>
            <li>
              {t('dynamicDesktop.level')}: {currentLevel}
            </li>
            {lastDecisionSource && (
              <li>
                {t('dynamicDesktop.decisionSource')}: {t(SOURCE_LABEL_KEYS[lastDecisionSource])}
              </li>
            )}
            <li>
              {t('dynamicDesktop.reason')}: {translateReason(currentPlan.reason.signals, t)}
            </li>
          </ul>
        ) : (
          <p>{t('dynamicDesktop.none')}</p>
        )}
      </div>

      <div className="mb-5">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--ag-primary)]"
            checked={prefs.hideBadge}
            onChange={(event) => setHideBadge(event.target.checked)}
          />
          {t('dynamicDesktop.hideBadge')}
        </label>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-xs text-text-muted">{t('dynamicDesktop.history')}</p>
        {history.length === 0 ? (
          <p className="text-xs text-text-muted">{t('dynamicDesktop.historyEmpty')}</p>
        ) : (
          <ul className="space-y-1" data-testid="dynamic-desktop-history">
            {history.map((entry, index) => (
              <li
                key={`${entry.plan.seed}-${index}`}
                className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-xs"
              >
                <span className="text-text-muted">
                  {new Date(entry.createdAt).toLocaleString()} ·{' '}
                  {t(`dynamicDesktop.style.${entry.plan.style}` as 'dynamicDesktop.style.fluid-gradient')} ·{' '}
                  {entry.level}
                </span>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-raised"
                  onClick={() => rollbackTo(index)}
                >
                  {t('dynamicDesktop.rollback')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          data-testid="dynamic-desktop-clear"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
          onClick={() => setClearOpen(true)}
        >
          {t('dynamicDesktop.clearData')}
        </button>
        <p className="mt-1 text-xs text-text-muted">{t('dynamicDesktop.clearHint')}</p>
      </div>

      {clearOpen && (
        <ConfirmDialog
          title={t('dynamicDesktop.clearData')}
          body={t('dynamicDesktop.clearConfirm')}
          confirmLabel={t('dynamicDesktop.clearData')}
          cancelLabel={t('dynamicDesktop.clearCancel')}
          busy={clearing}
          onConfirm={() => void clearAll()}
          onCancel={() => setClearOpen(false)}
        />
      )}
    </section>
  )
}

function translateReason(signals: readonly string[], t: (key: MessageKey) => string): string {
  const parts: string[] = []
  for (const signal of signals) {
    const colon = signal.indexOf(':')
    if (colon === -1) continue
    const kind = signal.slice(0, colon)
    const value = signal.slice(colon + 1)
    const kindKey = SIGNAL_KIND_KEYS[kind]
    const valueKey = SIGNAL_VALUE_KEYS[kind]?.[value]
    if (kindKey && valueKey) parts.push(`${t(kindKey)} ${t(valueKey)}`)
  }
  return parts.length > 0 ? parts.join(' + ') : t('dynamicDesktop.none')
}
