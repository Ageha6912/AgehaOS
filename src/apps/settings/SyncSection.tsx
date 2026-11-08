import { useEffect, useState } from 'react'

import { isRemoteAuthActive } from '@/core/auth'
import { formatMessage, useTranslation } from '@/core/i18n'
import { isSyncEnabled, SYNC_TOGGLE_EVENT } from '@/services/settings-sync'
import { useSessionStore } from '@/store/session-store'
import { useSyncStatusStore } from '@/store/sync-status-store'

/**
 * jsdom/旧浏览器回退：onLine 读不到按在线算（探测失败不谎报离线）。
 * 刻意不导出（react-refresh 单组件出口）；离线行为经组件测试钉住。
 */
function readNavigatorOnline(nav: Pick<Navigator, 'onLine'>): boolean {
  return nav.onLine !== false
}

function formatSyncTimestamp(at: number): string {
  return new Date(at).toLocaleString()
}

/**
 * Settings「同步」分区（M4-3 云同步状态面）：桌面与移动窄容器共用组件
 * （M2-6 契约自动生效——本分区内容零交互控件，无命中区诉求）。
 *
 * 真实性铁律（DESIGN §0.5）：同步没有手动触发能力，**不摆「立即同步」
 * 按钮**；所有降级行如实派生、不入状态库——本地认证模式（构建无远程
 * 认证）、未登录、开关关闭（入口提示指向「账户」分区的既有开关）。仅当
 * 「已登录 + 开关开」才展示状态库里的真实和解结果（上次成功 / 失败 /
 * 进行中）；离线读数 = navigator.onLine + online/offline 事件（M1
 * statusbar/sources 同款拆法：读数不可得按在线处理）。
 */
export function SyncSection() {
  const { t } = useTranslation()
  const user = useSessionStore((s) => s.user)
  const phase = useSyncStatusStore((s) => s.phase)
  const lastSuccessAt = useSyncStatusStore((s) => s.lastSuccessAt)
  const lastErrorAt = useSyncStatusStore((s) => s.lastErrorAt)
  const [online, setOnline] = useState(() => readNavigatorOnline(navigator))
  // 开关变化（账户分区 ToggleSwitch / setSyncEnabled 广播）驱动重渲染，
  // 与 MenuBar 的 SYNC_TOGGLE_EVENT 消费同款；初值读实时开关。
  const [syncOn, setSyncOn] = useState(isSyncEnabled)

  useEffect(() => {
    const refresh = (): void => {
      setOnline(readNavigatorOnline(navigator))
      setSyncOn(isSyncEnabled())
    }
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    window.addEventListener(SYNC_TOGGLE_EVENT, refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      window.removeEventListener(SYNC_TOGGLE_EVENT, refresh)
    }
  }, [])

  const remoteAuth = isRemoteAuthActive()
  // 远程状态块只在远程认证下成立（D2 审查）：本地构建 + localStorage 残留
  // 同步开关时会同时摆「本机模式无法同步」和远程状态块，自相矛盾。
  const statusVisible = remoteAuth && user !== null && syncOn

  return (
    <section aria-label={t('settings.sync.section')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('settings.sync.section')}</h2>

      {!remoteAuth && (
        <p data-testid="sync-mode-local" className="mb-3 text-xs text-text-muted">
          {t('settings.sync.modeLocal')}
        </p>
      )}
      {!user && (
        <p data-testid="sync-signed-out" className="mb-3 text-xs text-text-muted">
          {t('settings.sync.signedOut')}
        </p>
      )}
      {user !== null && remoteAuth && !syncOn && (
        <div data-testid="sync-disabled" className="mb-3">
          <p className="text-sm text-text">{t('settings.sync.disabled')}</p>
          <p className="mt-1 text-xs text-text-muted">{t('settings.sync.disabledHint')}</p>
        </div>
      )}

      {statusVisible && (
        <div data-testid="sync-status" className="rounded-md border border-border bg-surface-raised/50 p-3">
          {phase === 'syncing' ? (
            <p data-testid="sync-status-line" className="text-sm text-text">
              {t('settings.sync.phaseSyncing')}
            </p>
          ) : phase === 'error' ? (
            <>
              <p data-testid="sync-status-line" className="text-sm text-text">
                {formatMessage(t('settings.sync.lastFailedLine'), {
                  time: lastErrorAt !== null ? formatSyncTimestamp(lastErrorAt) : '',
                })}
              </p>
              {lastSuccessAt !== null && (
                <p data-testid="sync-last-success-line" className="mt-1 text-xs text-text-muted">
                  {formatMessage(t('settings.sync.lastSuccessLine'), {
                    time: formatSyncTimestamp(lastSuccessAt),
                  })}
                </p>
              )}
            </>
          ) : lastSuccessAt !== null ? (
            <p data-testid="sync-status-line" className="text-sm text-text">
              {formatMessage(t('settings.sync.lastSuccessLine'), {
                time: formatSyncTimestamp(lastSuccessAt),
              })}
            </p>
          ) : (
            <p data-testid="sync-status-line" className="text-sm text-text">
              {t('settings.sync.neverSynced')}
            </p>
          )}
          {!online && (
            <p data-testid="sync-offline" className="mt-1 text-xs text-text-muted">
              {t('settings.sync.offlineHint')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
