import { useEffect, useState } from 'react'

import { isRemoteAuthActive } from '@/core/auth'
import { BASIC_ECLOSION_SPECS } from '@/core/eclosion/spec'
import { formatMessage, useTranslation } from '@/core/i18n'
import { systemEclosion } from '@/services/eclosion'
import type { EclosionReplayEntry } from '@/services/eclosion-cache'
import { applyReplayTheme } from '@/services/world-theme'
import { useEclosionStore } from '@/store/eclosion-store'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ScrollFadeList } from '@/components/scroll-fade-list'
import { ToggleSwitch } from '@/components/toggle-switch'

/**
 * Settings「羽化」区（AI-GENERATED-APPS-DESIGN §9.3 准入 / §12 P1 Settings 四要素）：
 * 总开关（默认关；本地认证或服务端未配置 AI 时置灰并提示原因）、基础软件生成
 * 方式（三件套各自 羽化/经典，默认羽化）、额度显示（GET /api/eclosion/quota）、
 * 清除羽化数据（IndexedDB agehaos.eclosion 按用户整段删除）。
 * P4（§8/§10）：蝶谱时间线（每日世界的 replay 记录）+「回到那天的主题」。
 */

export function EclosionSection() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const modes = useEclosionStore((s) => s.modes)
  const themeFollow = useEclosionStore((s) => s.themeFollow)
  const quota = useEclosionStore((s) => s.quota)
  const userId = useEclosionStore((s) => s.userId)
  const setEnabled = useEclosionStore((s) => s.setEnabled)
  const setGenerateMode = useEclosionStore((s) => s.setGenerateMode)
  const setThemeFollow = useEclosionStore((s) => s.setThemeFollow)
  const [cleared, setCleared] = useState(false)
  const [replay, setReplay] = useState<EclosionReplayEntry[] | null>(null)
  // 清除数据 = 不可逆操作：二次确认 + 在途禁用 + 失败可见（D2 审查）。
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState(false)

  // 「已清除」是瞬时反馈：6s 后复位，避免此后永久宣称已清除（D2 审查）。
  useEffect(() => {
    if (!cleared) return
    const timer = window.setTimeout(() => setCleared(false), 6_000)
    return () => window.clearTimeout(timer)
  }, [cleared])

  // 蝶谱（§8）：开关开时读当前用户的 replay 记录（≤60 条，不存 HTML）。
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void systemEclosion.listReplay().then((entries) => {
      if (!cancelled) setReplay(entries)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, userId])

  const remoteAuth = isRemoteAuthActive()
  const aiConfigured = quota?.configured !== false
  // §9.3 准入：本地认证置灰；quota 快照显式 configured:false（未配置 Key 或
  // 服务端不可达）只在**开启方向**置灰——已持久化 enabled:true 的用户必须还能
  // 关掉（旧实现双向置灰，开关被锁死在开——D2 审查）。额度未知（null，尚未
  // 探测）不置灰——开错会自动回落。
  const toggleDisabled = !remoteAuth || (!enabled && !aiConfigured)

  // 打开分区即拉一次额度快照（Settings 是唯一的额度展示位）。
  useEffect(() => {
    void systemEclosion.refreshQuota()
  }, [])

  const clearEclosionData = async (): Promise<void> => {
    setClearing(true)
    setClearError(false)
    try {
      await systemEclosion.clearData()
      setCleared(true)
      // 蝶谱随缓存整段删除：时间线同步清空，不再显示已删条目。
      setReplay([])
      setClearOpen(false)
    } catch {
      setClearError(true)
    } finally {
      setClearing(false)
    }
  }

  return (
    <section aria-label={t('settings.eclosion.section')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('settings.eclosion.section')}</h2>

      <div className="mb-5">
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={enabled}
            label={t('settings.eclosion.enable')}
            testId="eclosion-enable-toggle"
            disabled={toggleDisabled}
            onClick={() => {
              const next = !enabled
              setEnabled(next)
              // 开启即安排空闲预取（§5.2：开关开且缓存缺失时）+ 拉取今日世界
              //（§6.2：就绪后经 world.ready 事件接主题与应用）。
              if (next) {
                systemEclosion.schedulePrefetch()
                void systemEclosion.refreshWorld()
              }
            }}
          />
          <span className={`text-xs ${toggleDisabled ? 'text-text-muted/60' : 'text-text'}`}>
            {t('settings.eclosion.enable')}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{t('settings.eclosion.enableHint')}</p>
        {!remoteAuth && <p className="mt-1 text-xs text-warning">{t('settings.eclosion.remoteOnlyHint')}</p>}
        {remoteAuth && !aiConfigured && (
          <p className="mt-1 text-xs text-warning" data-testid="eclosion-ai-not-configured">
            {t('settings.eclosion.aiNotConfigured')}
          </p>
        )}
      </div>

      {/* 主题跟随今日世界（§6.3）：默认开；关闭后不改主题、只保留今日应用。 */}
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <ToggleSwitch
            checked={themeFollow}
            label={t('settings.eclosion.themeFollow')}
            testId="eclosion-theme-follow-toggle"
            disabled={!enabled}
            onClick={() => {
              const next = !themeFollow
              setThemeFollow(next)
              // 重新打开且当日世界已在：重播就绪事件（当日缓存路径）→ 主题立即接回。
              if (next) void systemEclosion.refreshWorld()
            }}
          />
          <span className={`text-xs ${enabled ? 'text-text' : 'text-text-muted/60'}`}>
            {t('settings.eclosion.themeFollow')}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{t('settings.eclosion.themeFollowHint')}</p>
      </div>

      <div className="mb-5">
        <p className="mb-1 text-xs font-medium text-text">{t('settings.eclosion.generateMode')}</p>
        <p className="mb-2 text-xs text-text-muted">{t('settings.eclosion.generateModeHint')}</p>
        <ul className="space-y-2">
          {BASIC_ECLOSION_SPECS.map((spec) => {
            const mode = modes[spec.specId] ?? 'eclosion'
            return (
              <li
                key={spec.specId}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised/50 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-text">{t(spec.titleKey)}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {mode === 'eclosion' ? t('settings.eclosion.modeEclosion') : t('settings.eclosion.modeClassic')}
                  </span>
                </span>
                <ToggleSwitch
                  checked={mode === 'eclosion'}
                  label={`${t(spec.titleKey)} · ${t('settings.eclosion.modeEclosion')}`}
                  testId={`eclosion-mode-${spec.specId}-toggle`}
                  disabled={!enabled}
                  onClick={() => setGenerateMode(spec.specId, mode === 'eclosion' ? 'classic' : 'eclosion')}
                />
              </li>
            )
          })}
        </ul>
      </div>

      {/* 蝶谱时间线（§8/P4）：每日一条（headline/配色/应用名单/壁纸参数），
          「回到那天的主题」只恢复主题与壁纸、不恢复应用。 */}
      {enabled && (
        <div className="mb-5" data-testid="eclosion-replay-section">
          <p className="mb-1 text-xs font-medium text-text">{t('settings.eclosion.replay')}</p>
          <p className="mb-2 text-xs text-text-muted">{t('settings.eclosion.replayHint')}</p>
          {replay === null || replay.length === 0 ? (
            <p className="text-xs text-text-muted" data-testid="eclosion-replay-empty">
              {t('settings.eclosion.replayEmpty')}
            </p>
          ) : (
            <div className="flex h-64 flex-col rounded-md border border-border">
              <ScrollFadeList className="space-y-1.5 p-2" testId="eclosion-replay-list">
                {replay.map((entry) => (
                  <li
                    key={entry.worldDate}
                    data-testid="eclosion-replay-entry"
                    className="flex items-center gap-3 rounded-md border border-border bg-surface-raised/50 px-3 py-2"
                  >
                    {/* 配色条：世界 accentHue（Token 层同口径的色相表达）。 */}
                    <span
                      aria-hidden="true"
                      className="h-8 w-2 shrink-0 rounded-full"
                      style={{ background: `hsl(${entry.accentHue} 80% 55%)` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-text">
                        <span className="font-mono">{entry.worldDate}</span> · {entry.headline}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                        {entry.apps.map((app) => app.name).join(' · ')}
                      </span>
                    </span>
                    <button
                      type="button"
                      data-testid="eclosion-replay-revert"
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text"
                      onClick={() => {
                        applyReplayTheme(entry)
                      }}
                    >
                      ↺ {t('settings.eclosion.replayRevert')}
                    </button>
                  </li>
                ))}
              </ScrollFadeList>
            </div>
          )}
        </div>
      )}

      <div className="mb-5 rounded-md border border-border bg-surface-raised/50 p-3 text-xs">
        <p className="mb-1 text-text">{t('settings.eclosion.quotaLabel')}</p>
        {quota && quota.configured ? (
          <p data-testid="eclosion-quota" className="font-mono tabular-nums text-text-muted">
            {formatMessage(t('settings.eclosion.quotaLine'), {
              used: String(quota.basic.used),
              limit: String(quota.basic.limit),
            })}
            {quota.resetAtIso &&
              ` · ${formatMessage(t('settings.eclosion.quotaReset'), {
                time: new Date(quota.resetAtIso).toLocaleTimeString(),
              })}`}
          </p>
        ) : (
          <p data-testid="eclosion-quota" className="text-text-muted">
            {t('settings.eclosion.quotaUnavailable')}
          </p>
        )}
      </div>

      <div>
        <button
          type="button"
          data-testid="eclosion-clear"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
          onClick={() => {
            setClearError(false)
            setClearOpen(true)
          }}
        >
          {t('settings.eclosion.clearData')}
        </button>
        <p className="mt-1 text-xs text-text-muted">{t('settings.eclosion.clearHint')}</p>
        {cleared && (
          <p className="mt-1 text-xs text-success" data-testid="eclosion-cleared-notice">
            {t('settings.eclosion.cleared')}
          </p>
        )}
      </div>

      {clearOpen && (
        <ConfirmDialog
          title={t('settings.eclosion.clearData')}
          body={t('settings.eclosion.clearConfirm')}
          confirmLabel={t('settings.eclosion.clearData')}
          cancelLabel={t('settings.eclosion.clearCancel')}
          busy={clearing}
          error={clearError ? t('settings.eclosion.clearFailed') : null}
          onConfirm={() => void clearEclosionData()}
          onCancel={() => setClearOpen(false)}
        />
      )}
    </section>
  )
}
