import { useEffect, useRef, useState } from 'react'

import { Bell, CaretRight, X } from '@phosphor-icons/react'

import { useLocaleStore, useTranslation } from '@/core/i18n'
import { prefersReducedMotion } from '@/components/pop-motion'
import { getAppManifest } from '@/store/app-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import {
  notificationBodyText,
  notificationTitleText,
  useNotificationStore,
} from '@/store/notification-store'
import type { NotificationItem } from '@/store/notification-store'

import { notificationNavTarget } from './notification-nav'

/**
 * 移动通知中心（M2-2，HANDOFF §4.0-2）：Bottom Sheet 通知列表——历史查看、
 * 单条清除、全部清空、空态文案。数据源 = notification-store 既有列表（由
 * notification-bridge 从 app.crashed / eclosion.world.ready 等真实系统事件
 * 喂入，本组件零推送逻辑、零新引擎）；未读语义复用 store 既有的 read 标记
 * 与 unreadCount（无 schema 扩展）。
 *
 * 打开即 markAllRead（iOS 通知中心同款）：徽标语义 =「尚未在中心过目」；
 * 打开瞬间消化既有未读，查看期间新到达的 push 保持未读，关闭后徽标如实
 * 反映。store 为会话内存态（30 条 LRU、登出清空），徽标随同一生命周期，
 * 不做本地持久化。
 *
 * 关闭路径（MobileLauncher 同款切片契约）：backdrop 点击与 Esc（document
 * 捕获阶段）都回调 onClose——开关状态归持有方（MobileStatusBar 铃铛），
 * 关闭回焦铃铛。
 *
 * 过渡动效（DESIGN.md §35.5）：进出场 200ms 只动 transform/opacity（既有
 * token --ag-motion-base）；prefers-reduced-motion 由全局 0.01ms 塌缩承接
 * （index.css，不建第二套开关）；motion-prefs「窗口切换转场」关档走
 * .mobile-notification-static 直切；退场「渲染滞后一拍」后卸载，期间
 * pointer-events-none + aria-hidden。
 *
 * 玻璃克制（DESIGN.md §35.1）：Bottom Sheet 是玻璃白名单五处之一——唯一
 * 玻璃层 = surface-glass 基底 + glass-raise（Dock/启动器抽屉同档）；
 * backdrop 遮罩纯色压暗（零 blur）。触控纪律（§35.3）：清除按钮与清空
 * 按钮命中区 ≥44×44。
 *
 * M4-2 通知点击跳转：桥从 app.crashed / eclosion.app.failed 载荷存入的
 * targetAppId（notification-store.ts 字段注释）+ 目标在册（getAppManifest
 * 解析面与 launchApp 同源）→ 行主体渲染为按钮：点按 = markRead（点按即
 * 已过目，iOS 通知中心同款）→ mobile-nav-store openApp（最近任务模型：
 * 活记录切回既有窗口 / 无记录新开，真实启动仍归 AppHost）→ onClose 关
 * sheet（与 backdrop/Esc 同一出口，开关状态归状态栏铃铛）。载荷无 appId
 * 或目标已注销 → 纯展示整条不可点（不伪造，判定在 notification-nav.ts
 * 纯函数）。
 */
/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const SHEET_TRANSITION_MS = 200

/** sheet 相位：closed = 不渲染；open = 在场；leaving = 退场帧（播完即卸载）。 */
type SheetPhase = 'closed' | 'open' | 'leaving'

function timeOf(createdAt: number, locale: 'zh-CN' | 'en'): string {
  return new Date(createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/** 单条通知行：标题（未读点亮点）+ 正文（词典键渲染）+ 时间 + 44×44 清除钮。
 * 带 targetAppId 且目标在册 → 行主体为跳转按钮（M4-2，判定见 notification-nav）。 */
function NotificationRow({ item, onClose }: { item: NotificationItem; onClose: () => void }) {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const remove = useNotificationStore((s) => s.remove)
  const markRead = useNotificationStore((s) => s.markRead)
  const openApp = useMobileNavStore((s) => s.openApp)
  const body = notificationBodyText(item, t) || null
  const target = notificationNavTarget(item, (appId) => getAppManifest(appId) !== null)

  const content = (
    <>
      <p className="text-sm font-medium text-text">
        {!item.read && (
          <span
            aria-hidden="true"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
          />
        )}
        {notificationTitleText(item, t)}
      </p>
      {body && <p className="mt-0.5 text-xs text-text-muted">{body}</p>}
      <p className="mt-1 text-[11px] tabular-nums text-text-muted">
        {timeOf(item.createdAt, locale)}
      </p>
    </>
  )

  return (
    <li
      data-testid="mobile-notification-item"
      data-read={item.read ? 'true' : 'false'}
      data-navigable={target !== null ? 'true' : 'false'}
      className={`flex items-start gap-1 rounded-xl border p-3 pr-1.5 ${
        item.read ? 'border-border bg-surface' : 'border-primary/40 bg-primary/5'
      }`}
    >
      {target !== null ? (
        /* 跳转按钮：行主体整块命中（内容自然高 + min-h 44 兜底，§35.3）；
           可访问名 = 通知文本 + sr-only「打开」（词典键，不做字符串拼接）。 */
        <button
          type="button"
          data-testid="mobile-notification-open"
          data-target-app-id={target}
          onClick={() => {
            markRead(item.id)
            openApp(target)
            onClose()
          }}
          className="flex min-h-[44px] min-w-0 flex-1 flex-col items-start rounded-xl text-left transition-opacity active:opacity-80"
        >
          {content}
          <span className="sr-only">{t('notification.open')}</span>
        </button>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}
      {target !== null && (
        <CaretRight
          size={14}
          weight="regular"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-text-tertiary"
        />
      )}
      <button
        type="button"
        data-testid="mobile-notification-remove"
        aria-label={t('notification.remove')}
        onClick={() => remove(item.id)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted transition-opacity active:opacity-80"
      >
        <X size={16} weight="regular" aria-hidden="true" />
      </button>
    </li>
  )
}

export function MobileNotificationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const items = useNotificationStore((s) => s.items)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clear = useNotificationStore((s) => s.clear)
  // 窗口切换转场档（motion-prefs）：关档 = sheet 直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((s) => s.windowTilt)

  // ── 开关状态机：与 MobileLauncher 同款（open→false 不经 null 空档，退场
  //    帧与原树同一 commit 接续；渲染期校正，重开即时恢复入场）。 ──────────
  const [phase, setPhase] = useState<SheetPhase>(open ? 'open' : 'closed')
  if (open && phase !== 'open') setPhase('open')
  if (!open && phase === 'open') setPhase('leaving')

  useEffect(() => {
    if (phase !== 'leaving') return
    // 减弱动效/静态档：退场立即收尾（F1 审查——旧实现仍等 200ms，
    // 用户看到静止遮罩且 pointer-events-none 期点击穿透 Home）。
    const timer = window.setTimeout(
      () => setPhase('closed'),
      prefersReducedMotion() ? 0 : SHEET_TRANSITION_MS,
    )
    return () => window.clearTimeout(timer)
  }, [phase])

  // 打开即全部已读（语义见模块注释）：仅在进入 open 相位时分发；查看期间
  // 新 push 保持未读（phase 不变，effect 不重跑），关闭后徽标如实反映。
  useEffect(() => {
    if (phase === 'open') markAllRead()
  }, [phase, markAllRead])

  // ── Esc 关闭：document 捕获阶段（MobileLauncher 同款，不参与桌面
  //    popover-store 互斥）；onClose 走 ref 免监听重挂；只在 open 相位监听。 ──
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (phase !== 'open') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  if (phase === 'closed') return null

  return (
    <div
      data-testid="mobile-notification-center"
      data-state={phase}
      aria-hidden={phase === 'leaving' ? true : undefined}
      className={`mobile-notification fixed inset-0 z-20 ${
        phase === 'leaving' ? 'pointer-events-none' : ''
      } ${transitionsOn ? '' : 'mobile-notification-static'}`}
    >
      {/* backdrop：纯色压暗遮罩（零 blur，非玻璃面），点击关闭。 */}
      <div
        data-testid="mobile-notification-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="mobile-notification-backdrop absolute inset-0"
      />
      {/* sheet：玻璃白名单五处之一的 Bottom Sheet 位（§35.1）——surface-glass
          基底 + glass-raise（Dock 同档 blur 20px），顶部发丝边；锚底升出，
          上限 80% 视口（MobileLauncher 同款）。 */}
      <div
        data-testid="mobile-notification-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('notification.center')}
        className="mobile-notification-sheet surface-glass glass-raise absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-2xl border-t"
        style={{ borderColor: 'var(--ag-border-subtle)' }}
      >
        {/* 抓手条：纯装饰（aria-hidden），Bottom Sheet 的形态语言。 */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
          style={{ backgroundColor: 'var(--ag-border-strong)' }}
        />
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--ag-text)' }}>
            {t('notification.center')}
          </p>
          {/* 清空按钮只在有通知时在场（禁止空态死按钮，§35.7 同口径）；
              命中区 ≥44×44（§35.3）。文案复用桌面通知中心同一词典键。 */}
          {items.length > 0 && (
            <button
              type="button"
              data-testid="mobile-notification-clear"
              onClick={clear}
              className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium transition-opacity active:opacity-80"
              style={{ color: 'var(--ag-primary)' }}
            >
              {t('notification.clear')}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          /* 空态：状态文案不是可点死元素（桌面通知中心同构图语言：
             半透明铃铛 + notification.empty）。 */
          <div
            data-testid="mobile-notification-empty"
            className="flex flex-col items-center gap-2 px-6 pb-10 pt-6 text-center"
          >
            <Bell
              size={28}
              weight="regular"
              aria-hidden="true"
              className="text-text-tertiary opacity-60"
            />
            <p className="text-sm text-text-tertiary">{t('notification.empty')}</p>
          </div>
        ) : (
          /* 列表滚动容器：overscroll-contain 防滚动链传给壳根（与
             .mobile-content-scroll 同口径）。 */
          <ul
            data-testid="mobile-notification-list"
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2 pb-2"
          >
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onClose={onClose} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
