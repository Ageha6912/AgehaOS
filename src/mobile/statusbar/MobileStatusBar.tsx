import { useTranslation } from '@/core/i18n'
import { useSessionStore } from '@/store/session-store'

import { useClock } from '@/components/use-clock'

import { useBatteryLevel, useNetworkState } from './use-statusbar-sources'

/**
 * 移动状态栏（M1-1，填充 M0 的 `mobile-statusbar-slot` 占位带）：左侧系统
 * 时钟，右侧真实状态簇——电池电量（Battery Status API）→ 网络
 * （onLine + connection.effectiveType）→ 当前用户。数据源全部真实
 * （DESIGN.md §0.5 拒绝装饰性谎言）：getBattery / connection 不可用整体
 * 隐藏，绝不显示示例读数；读数订阅系统事件实时跟随，不是一次性快照。
 *
 * 视觉（DESIGN.md §35）：占位带高度契约仍由 index.css 的
 * `max(var(--safe-top), 24px)` 承担（不写死），本组件只在其内铺一行 11px
 * 等宽数据读出（§0.6 最小字号 11px）；状态条是玻璃白名单的 Header 位
 * （§35.1），M1-1 沿用 M0 的实色 --ag-surface 底不引入 blur。纯指示器
 * 无可点目标，44px touch-target 规则（§35.3）不适用。
 */
export function MobileStatusBar() {
  const { t } = useTranslation()
  const clock = useClock()
  const battery = useBatteryLevel()
  const network = useNetworkState()
  const user = useSessionStore((state) => state.user)
  const displayName = user ? (user.displayName ?? user.username) : null

  return (
    <div
      data-testid="mobile-statusbar"
      className="flex h-full items-center justify-between gap-3 px-4 text-[11px] tabular-nums"
      style={{ color: 'var(--ag-text-muted)' }}
    >
      <time
        data-testid="mobile-statusbar-clock"
        className="shrink-0 font-medium"
        style={{ color: 'var(--ag-text)' }}
      >
        {clock}
      </time>
      <div className="flex min-w-0 items-center gap-3">
        {battery !== null && (
          <span
            data-testid="mobile-statusbar-battery"
            aria-label={`${t('mobile.statusbar.battery')} ${battery}%`}
            className="shrink-0"
          >
            {battery}%
          </span>
        )}
        {network !== null && (
          <span
            data-testid="mobile-statusbar-network"
            aria-label={`${t('mobile.statusbar.network')} ${network.online ? network.effectiveType : t('mobile.statusbar.networkOffline')}`}
            className="shrink-0"
          >
            {network.online ? network.effectiveType : t('mobile.statusbar.networkOffline')}
          </span>
        )}
        {displayName !== null && (
          <span
            data-testid="mobile-statusbar-user"
            aria-label={t('mobile.statusbar.user')}
            className="max-w-32 truncate"
          >
            {displayName}
          </span>
        )}
      </div>
    </div>
  )
}
