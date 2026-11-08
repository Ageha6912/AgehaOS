import { useRef } from 'react'

import { Bell, SlidersHorizontal } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { unreadCount, useNotificationStore } from '@/store/notification-store'
import { useMobileSheetStore } from '@/store/mobile-sheet-store'
import { useSessionStore } from '@/store/session-store'

import { useClock } from '@/components/use-clock'

import { MobileControlCenterSheet } from '../controlcenter/MobileControlCenterSheet'
import { MobileNotificationSheet } from '../notifications/MobileNotificationSheet'
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
 * （§35.1），M1-1 沿用 M0 的实色 --ag-surface 底不引入 blur。
 *
 * M2-2 通知中心入口：右侧通知铃铛 + 未读徽标（= notification-store 未读数，
 * unreadCount 既有纯函数；>9 折叠 9+，桌面铃铛同口径）+ 点按开 Bottom
 * Sheet（../notifications/MobileNotificationSheet，数据源 = notification-bridge
 * 事件流）。
 *
 * M2-3 控制中心入口：铃铛旁调节图标按钮（最右位，iOS 控制中心同角）+ 点按
 * 开 Bottom Sheet（../controlcenter/MobileControlCenterSheet）——开合状态与
 * 通知中心同归 mobile-sheet-store（F1/F2 审查：状态提升到 store 后
 * MobileAppHost 才能把两张 sheet 纳入 history 分层栈，Android 返回键先关
 * sheet 而不是退出应用/离开 AgehaOS），与通知中心互斥天然成立（sheet 的
 * 全屏 backdrop 盖住状态栏，另一个入口不可点）。
 *
 * §35.3 触控纪律：铃铛/调节按钮命中区 44×44——占位带最小 24px 高（M0-4
 * 契约），44px 盒居中必然上溢视口被裁，故用 ::after 把命中区自盒中心向下
 * 延伸 44px，任何占位带高度下有效命中 ≥44px（下延区在 Home/应用视图顶部
 * 均为非交互留白，无目标冲突；z-20 压过 AppHost 的 z-10）。图标本体仍与
 * 读数行同线居中（含刘海档 59px 槽）。
 */
export function MobileStatusBar() {
  const { t } = useTranslation()
  const clock = useClock()
  const battery = useBatteryLevel()
  const network = useNetworkState()
  const user = useSessionStore((state) => state.user)
  const displayName = user ? (user.displayName ?? user.username) : null
  // M2-2 通知中心：未读数直接订阅 store（unreadCount 纯函数，原始类型
  // 选择器无引用相等问题）；开合归 mobile-sheet-store（history 分层栈的
  // 接线口在 AppHost，见模块注释），关闭回焦铃铛（桌面弹层关闭契约 §0.4
  // 的移动口径）。
  const unread = useNotificationStore((state) => unreadCount(state.items))
  const centerOpen = useMobileSheetStore((state) => state.notificationsOpen)
  const openCenter = useMobileSheetStore((state) => state.openNotifications)
  const closeNotifications = useMobileSheetStore((state) => state.closeNotifications)
  const bellRef = useRef<HTMLButtonElement>(null)
  const closeCenter = (): void => {
    closeNotifications()
    bellRef.current?.focus()
  }
  // M2-3 控制中心：开合同归 mobile-sheet-store，关闭回焦调节按钮。
  const controlOpen = useMobileSheetStore((state) => state.controlCenterOpen)
  const openControl = useMobileSheetStore((state) => state.openControlCenter)
  const closeControlCenter = useMobileSheetStore((state) => state.closeControlCenter)
  const controlRef = useRef<HTMLButtonElement>(null)
  const closeControl = (): void => {
    closeControlCenter()
    controlRef.current?.focus()
  }

  return (
    <>
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
        {/* M2-2 通知铃铛：44×44 命中区（::after 下延，见模块注释 §35.3 段）；
            徽标 = 未读数（>9 折叠 9+，桌面铃铛同口径），无未读不渲染。 */}
        <button
          type="button"
          ref={bellRef}
          data-testid="mobile-notification-bell"
          aria-label={t('notification.center')}
          aria-haspopup="dialog"
          aria-expanded={centerOpen}
          onClick={openCenter}
          className="relative z-20 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-opacity after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:content-[''] active:opacity-80"
        >
          <span className="relative">
            <Bell size={16} weight="regular" aria-hidden="true" style={{ color: 'var(--ag-text)' }} />
            {unread > 0 && (
              <span
                data-testid="mobile-notification-badge"
                aria-hidden="true"
                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-contrast"
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
        </button>
        {/* M2-3 控制中心入口：44×44 命中区（::after 下延，与铃铛同款，见模块
            注释 §35.3 段）；右侧簇最右位（iOS 控制中心同角），i18n 可访问名。 */}
        <button
          type="button"
          ref={controlRef}
          data-testid="mobile-control-center-entry"
          aria-label={t('mobile.controlcenter.open')}
          aria-haspopup="dialog"
          aria-expanded={controlOpen}
          onClick={openControl}
          className="relative z-20 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-opacity after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:content-[''] active:opacity-80"
        >
          <SlidersHorizontal
            size={16}
            weight="regular"
            aria-hidden="true"
            style={{ color: 'var(--ag-text)' }}
          />
        </button>
      </div>
      </div>
      {/* M2-2 通知中心 Bottom Sheet：fixed 全屏覆盖层，开关状态在本组件。 */}
      <MobileNotificationSheet open={centerOpen} onClose={closeCenter} />
      {/* M2-3 控制中心 Bottom Sheet：同款覆盖层，开关状态在本组件。 */}
      <MobileControlCenterSheet open={controlOpen} onClose={closeControl} />
    </>
  )
}
