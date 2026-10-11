import { useEffect, useRef, useState } from 'react'

import { X } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName } from '@/apps/launch'
import { formatMessage, useLocaleStore, useTranslation } from '@/core/i18n'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import type { MobileAppRecord } from '@/store/mobile-nav-store'
import { useMobileRecentsStore } from '@/store/mobile-recents-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

import { useRecentsCardDismiss } from './use-recents-card-dismiss'

/**
 * 移动最近任务切换器（M3-2，HANDOFF §4.0 屏⑦）：Bottom Sheet 卡片区——
 * 已开应用卡片（AppIcon + 名称 + 打开时间，横向轨道 iOS 切换器同款），
 * 点卡片切回（switchToApp，不重新 launch）、卡片上滑或删除钮关闭单 app
 * （closeApp）、「全部关闭」（closeAllApps）。「仍是全屏单实例范式」：
 * 切回与关闭全部经 mobile-nav-store 纯状态，真实关窗由 MobileAppHost 的
 * 记录订阅执行（app.stopped 派生正确）。
 *
 * 数据 = mobile-nav-store 的 apps 记录（打开序旧→新，卡片呈现反转新→旧）；
 * 名称走 appDisplayName 本地化展示名（与 Dock/启动器同源），时间是
 * toLocaleTimeString 数据（通知中心同口径）。
 *
 * 空态 = 整层不可达（切片口径，无空壳文案）：入口档在 Dock（唯一入口按
 * apps.length 放行）；本组件兜底——开着时记录被清空（最后一张卡被上滑
 * 关掉 / 全部关闭）立即回调 onClose 退场，不留空 sheet。
 *
 * 关闭路径（MobileLauncher 同款切片契约）：backdrop 点击与 Esc（document
 * 捕获阶段）都回调 onClose——开关状态归持有方（MobileShell，经
 * mobile-recents-store），关闭回焦 Dock Home 位触发器（回焦接线在持有方，
 * 桌面弹层关闭契约 §0.4 的移动口径）。
 *
 * 浏览器返回键与切换卡的层级（popstate 消费者唯一 = MobileAppHost）：覆盖
 * 层打开时 AppHost 压自己的栈位，返回键先关覆盖层；点卡片关闭属 UI 关闭，
 * 不调 history.back（双跳禁令），残留栈位只在同文档内移动（M1-6 口径）。
 *
 * 过渡动效（DESIGN.md §35.5）：进出场 200ms 只动 transform/opacity（既有
 * token --ag-motion-base）；prefers-reduced-motion 由全局 0.01ms 塌缩承接；
 * motion-prefs「窗口切换转场」关档走 .mobile-recents-static 直切。退场
 * 「渲染滞后一拍」后卸载，期间 pointer-events-none + aria-hidden。
 *
 * 玻璃克制（DESIGN.md §35.1）：Bottom Sheet 是玻璃白名单五处之一——唯一
 * 玻璃层 = surface-glass 基底 + glass-raise（Dock/三张 M2 sheet 同档）；
 * backdrop 纯色压暗（零 blur）。触控纪律（§35.3）：删除钮 44×44、全部
 * 关闭 min-h-[44px]、卡片 ≥44px。
 *
 * 卡片轨道横滚与上滑关闭的划界（M2-4 touch-action 方法学）：轨道
 * overflow-x 横滚（pan-x），卡片 touch-action: pan-x——纵向拖拽无原生
 * 滚动面可认领，pointer 事件全程可达卡片手势（上滑关闭）；横向拖拽归
 * 轨道原生横滚（浏览器接管即 pointercancel，手势静默复位）。两轴正交，
 * 冲突在 touch-action 划界上消解（与 Files 工具栏豁免面同一手法）。
 */
/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const SHEET_TRANSITION_MS = 200

/** sheet 相位：closed = 不渲染；open = 在场；leaving = 退场帧（播完即卸载）。 */
type SheetPhase = 'closed' | 'open' | 'leaving'

function timeOf(openedAt: number, locale: 'zh-CN' | 'en'): string {
  return new Date(openedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/** 单张已开应用卡：点卡片切回 + 44×44 删除钮 + 上滑关闭（手势在
 * use-recents-card-dismiss，判定纯函数见 recents-card-decision）。 */
function RecentsCard({ app }: { app: MobileAppRecord }) {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const switchToApp = useMobileNavStore((s) => s.switchToApp)
  const closeApp = useMobileNavStore((s) => s.closeApp)
  const closeRecents = useMobileRecentsStore((s) => s.closeRecents)
  // 窗口切换转场档（motion-prefs）：关档 = 卡片手势直切（见模块注释）。
  const transitionsOn = useMotionPrefsStore((s) => s.windowTilt)
  const cardRef = useRef<HTMLButtonElement | null>(null)
  useRecentsCardDismiss({
    targetRef: cardRef,
    followMotion: transitionsOn,
    onDismiss: () => closeApp(app.windowId),
  })
  const name = appDisplayName(app.appId)

  return (
    <li className="relative shrink-0">
      <button
        ref={cardRef}
        type="button"
        data-testid="mobile-recents-card"
        data-app-id={app.appId}
        data-window-id={app.windowId}
        aria-label={formatMessage(t('mobile.recents.cardLabel'), {
          name,
          time: timeOf(app.openedAt, locale),
        })}
        onClick={() => {
          // 切回 = nav 指向已有 windowId（不重新 launch）+ 关覆盖层；点当
          // 前应用卡时 switchToApp 等值跳过，只关层。
          switchToApp(app.windowId)
          closeRecents()
        }}
        className="mobile-recents-card flex h-28 w-44 flex-col items-center justify-center gap-1.5 rounded-2xl border px-3 py-2 text-left transition-colors active:opacity-90"
        style={{ borderColor: 'var(--ag-border-subtle)', backgroundColor: 'var(--ag-surface-raised)' }}
      >
        {/* AppIcon 无 label = 装饰位（aria-hidden），可访问名由 aria-label
            承担（应用名 + 打开时间从句，Dock/启动器同口径）。 */}
        <AppIcon appId={app.appId} size={40} />
        <span className="w-full truncate text-center text-sm font-medium" style={{ color: 'var(--ag-text)' }}>
          {name}
        </span>
        <time
          dateTime={new Date(app.openedAt).toISOString()}
          className="w-full truncate text-center text-[11px] tabular-nums"
          style={{ color: 'var(--ag-text-muted)' }}
        >
          {formatMessage(t('mobile.recents.openedAt'), { time: timeOf(app.openedAt, locale) })}
        </time>
      </button>
      {/* 删除钮：44×44 命中区（§35.3），可访问名带应用名；与卡片按钮是
          兄弟节点（button 不嵌套），叠在卡片右上角。 */}
      <button
        type="button"
        data-testid="mobile-recents-card-close"
        aria-label={formatMessage(t('mobile.recents.close'), { name })}
        onClick={() => closeApp(app.windowId)}
        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-text-muted transition-opacity active:opacity-80"
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </li>
  )
}

export function MobileRecentsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const apps = useMobileNavStore((s) => s.apps)
  const closeAllApps = useMobileNavStore((s) => s.closeAllApps)
  // 窗口切换转场档（motion-prefs）：关档 = sheet 直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((s) => s.windowTilt)

  // ── 开关状态机：与 MobileLauncher 同款（open→false 不经 null 空档，退场
  //    帧与原树同一 commit 接续；渲染期校正，重开即时恢复入场）。 ──────────
  const [phase, setPhase] = useState<SheetPhase>(open ? 'open' : 'closed')
  if (open && phase !== 'open') setPhase('open')
  if (!open && phase === 'open') setPhase('leaving')

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('closed'), SHEET_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // 空态兜底（整层不可达的后半档）：开着时记录清空 → 立即退场，不留空
  // sheet（触发点：最后一张卡上滑/删除、全部关闭、后台窗被外部关光的
  // 哨兵剪枝）。onClose 走 ref 免监听重挂。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (phase === 'open' && apps.length === 0) onCloseRef.current()
  }, [phase, apps.length])

  // ── Esc 关闭：document 捕获阶段（MobileLauncher 同款，不参与桌面
  //    popover-store 互斥）；只在 open 相位监听（leaving 已在退场）。 ──────
  useEffect(() => {
    if (phase !== 'open') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  if (phase === 'closed') return null

  // 呈现序 = 打开序反转（新→旧，最近任务语义）；打开瞬间 apps 非空由入口
  // 档保证，兜底档保证清空即刻退场，空轨道只在退场帧里出现。
  const cards = [...apps].reverse()

  return (
    <div
      data-testid="mobile-recents"
      data-state={phase}
      aria-hidden={phase === 'leaving' ? true : undefined}
      className={`mobile-recents fixed inset-0 z-20 ${
        phase === 'leaving' ? 'pointer-events-none' : ''
      } ${transitionsOn ? '' : 'mobile-recents-static'}`}
    >
      {/* backdrop：纯色压暗遮罩（零 blur，非玻璃面），点击关闭。 */}
      <div
        data-testid="mobile-recents-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="mobile-recents-backdrop absolute inset-0"
      />
      {/* sheet：玻璃白名单五处之一的 Bottom Sheet 位（§35.1）——surface-glass
          基底 + glass-raise（Dock 同档 blur 20px），顶部发丝边；锚底升出，
          上限 80% 视口（三张 M2 sheet 同构）。 */}
      <div
        data-testid="mobile-recents-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.recents.title')}
        className="mobile-recents-sheet surface-glass glass-raise absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-2xl border-t"
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
            {t('mobile.recents.title')}
          </p>
          {/* 全部关闭：只在有卡片时在场（禁止空态死按钮，§35.7 同口径）；
              命中区 ≥44×44（§35.3）。 */}
          {cards.length > 0 && (
            <button
              type="button"
              data-testid="mobile-recents-close-all"
              onClick={closeAllApps}
              className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium transition-opacity active:opacity-80"
              style={{ color: 'var(--ag-primary)' }}
            >
              {t('mobile.recents.closeAll')}
            </button>
          )}
        </div>
        {/* 卡片轨道：横向滚动（overflow-x + overscroll-contain 防滚动链），
            touch-action: pan-x 由 index.css 移动段声明（与卡片上滑关闭的
            两轴划界，见模块注释）；轨道是纵向唯一滚动面之外的横滚面。 */}
        <div
          data-testid="mobile-recents-rail"
          className="mobile-recents-rail min-h-0 flex-1 overflow-x-auto overscroll-contain px-4 pb-4 pt-1"
        >
          <ul className="flex w-max gap-3" data-testid="mobile-recents-cards">
            {cards.map((app) => (
              <RecentsCard key={app.windowId} app={app} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
