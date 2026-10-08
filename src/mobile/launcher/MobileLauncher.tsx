import { useEffect, useRef, useState } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useAppStore } from '@/store/app-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

import { orderAppsForMobileGrid } from '../shared/mobile-app-order'
import { filterAppsForLauncher } from './launcher-filter'

/**
 * 移动启动器（M2-1，HANDOFF §4.0-1）：Bottom Sheet 应用抽屉——全部已安装
 * 应用（`useAppStore.apps` 经 `orderAppsForMobileGrid` 排序，与 Home 应用
 * 网格同一优先序纯函数）+ 顶部实时搜索框（按 manifest.name 大小写不敏感
 * 过滤，./launcher-filter 纯函数）+ 无结果空态文案。列表项整行命中区
 * ≥44×44px（DESIGN.md §35.3）；点击 = `mobile-nav-store.openApp(appId)`
 * 并回调 onClose 关闭抽屉（与 Home 其余入口同一导航语义，真实启动仍归
 * M1-6 AppHost）。
 *
 * 关闭路径（切片契约）：backdrop 点击与 Esc（document 捕获阶段）都回调
 * onClose——开关状态归持有方（MobileAppGrid 入口按钮），本组件自持的只有
 * 查询串与退场帧。搜索框打开即聚焦（桌面启动器 §0.4「打开即聚焦搜索框」
 * 的移动口径）；重新打开时查询串复位，不残留上一次的过滤。
 *
 * 过渡动效（DESIGN.md §35.5）：进出场 200ms 只动 transform/opacity（既有
 * token --ag-motion-base，档带 160–220ms 内）；prefers-reduced-motion 由
 * 全局 0.01ms 塌缩承接（index.css，不建第二套开关）；motion-prefs 的
 * 「窗口切换转场」档（useMotionPrefsStore.windowTilt——MobileAppHost 同款
 * 唯一转场开关）关闭时走 .mobile-launcher-static 直切。退场用「渲染滞后
 * 一拍」（MobileAppHost 同款）：open→false 后带 data-state='leaving' 播完
 * 退场再卸载，期间 pointer-events-none + aria-hidden，不挡底下 Home。
 *
 * 玻璃克制（DESIGN.md §35.1）：Bottom Sheet 是玻璃白名单五处之一——唯一
 * 玻璃层 = surface-glass 基底 + glass-raise（与 Dock 同档）；backdrop 遮罩
 * 是纯色压暗（非玻璃、零 blur），清单外不引入第二个 blur 面。
 */
/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const LAUNCHER_TRANSITION_MS = 200

/** 抽屉相位：closed = 不渲染；open = 在场；leaving = 退场帧（播完即卸载）。 */
type LauncherPhase = 'closed' | 'open' | 'leaving'

export function MobileLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const apps = useAppStore((state) => state.apps)
  const openApp = useMobileNavStore((state) => state.openApp)
  // 窗口切换转场档（motion-prefs）：关档 = 抽屉直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((state) => state.windowTilt)

  // 每次渲染重排 + 重滤（不 memo，MobileAppGrid 同口径）：locale 切换后
  // 需重取本地化展示名；过滤纯函数保序，排序职责单点在 mobile-app-order。
  const [query, setQuery] = useState('')
  const items = filterAppsForLauncher(orderAppsForMobileGrid(apps, appDisplayName), query)

  // ── 开关状态机：open↔false 在渲染期同步落到 phase（React「props 变化时
  //    调整派生 state」官方模式）。关键约束：open→false **不经 null 空档**
  //    ——退场帧与原树同一 commit 接续，sheet 元素不重挂（input 的 autoFocus
  //    不重触发，关闭回焦触发器不会被抢回；渲染滞后一拍再卸载 = MobileAppHost
  //    同款）。open→true 立即恢复入场；closed 才真正不渲染。 ──────────────
  const [phase, setPhase] = useState<LauncherPhase>(open ? 'open' : 'closed')
  if (open && phase !== 'open') setPhase('open')
  if (!open && phase === 'open') setPhase('leaving')

  // 退场帧计时：leaving 播完 200ms → closed（卸载）；期间重开由渲染期校正
  // 直接回 open，本 effect 的 cleanup 撤销未到的计时器。
  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('closed'), LAUNCHER_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // 打开即复位查询串（不残留上一次过滤）；closed→open 重挂时同步生效。
  useEffect(() => {
    if (phase === 'open') setQuery('')
  }, [phase])

  // ── Esc 关闭：document 捕获阶段（桌面弹层契约 §0.4 的移动口径，不参与
  //    桌面 popover-store 互斥——移动侧没有多弹层并存面）；onClose 走 ref
  //    免监听重挂；只在 open 相位监听（leaving 已在退场，不重复回调）。 ──
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

  const select = (appId: string): void => {
    // 选中即分发：openApp 推进导航（AppHost 真实启动）+ 关闭抽屉——App 视
    // 图挂起后 Home 卸载，抽屉随宿主树一起退场，无需等待退场动画。
    openApp(appId)
    onClose()
  }

  return (
    <div
      data-testid="mobile-launcher"
      data-state={phase}
      aria-hidden={phase === 'leaving' ? true : undefined}
      className={`mobile-launcher fixed inset-0 z-20 ${
        phase === 'leaving' ? 'pointer-events-none' : ''
      } ${transitionsOn ? '' : 'mobile-launcher-static'}`}
    >
      {/* backdrop：纯色压暗遮罩（零 blur，非玻璃面），点击关闭（切片契约）。 */}
      <div
        data-testid="mobile-launcher-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="mobile-launcher-backdrop absolute inset-0"
      />
      {/* sheet：玻璃白名单五处之一的 Bottom Sheet 位（§35.1）——surface-glass
          基底 + glass-raise（Dock 同档 blur 20px），顶部发丝边；锚底升出，
          上限 80% 视口给 Home 留呼吸。 */}
      <div
        data-testid="mobile-launcher-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.launcher.open')}
        className="mobile-launcher-sheet surface-glass glass-raise absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-2xl border-t"
        style={{ borderColor: 'var(--ag-border-subtle)' }}
      >
        {/* 抓手条：纯装饰（aria-hidden），Bottom Sheet 的形态语言。 */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
          style={{ backgroundColor: 'var(--ag-border-strong)' }}
        />
        <div className="shrink-0 px-4 pb-2 pt-3">
          <input
            data-testid="mobile-launcher-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('mobile.launcher.searchPlaceholder')}
            aria-label={t('mobile.launcher.searchPlaceholder')}
            autoFocus
            className="h-11 w-full rounded-xl border px-3 text-sm transition-opacity focus:outline-none"
            style={{
              borderColor: 'var(--ag-border-subtle)',
              color: 'var(--ag-text)',
              backgroundColor: 'var(--ag-surface-raised)',
            }}
          />
        </div>
        {/* 列表滚动容器：overscroll-contain 防滚动链传给壳根（与
            .mobile-content-scroll 同口径）；行命中区 ≥44×44（§35.3）。 */}
        <div
          data-testid="mobile-launcher-list"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
        >
          <ul data-testid="mobile-launcher-items">
            {items.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  data-testid="mobile-launcher-item"
                  data-app-id={app.id}
                  onClick={() => select(app.id)}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-opacity active:opacity-80"
                >
                  {/* AppIcon 无 label = 装饰位（aria-hidden），可访问名由
                      应用名文本承担（网格/最近使用同口径）。 */}
                  <AppIcon appId={app.id} size={44} />
                  <span
                    className="min-w-0 truncate text-sm"
                    style={{ color: 'var(--ag-text)' }}
                  >
                    {appDisplayName(app.id)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* 无结果空态：状态文案不是可点死元素（§35.7 空态铁律的搜索口径
              ——缺席的是结果，抽屉本身在场）。 */}
          {items.length === 0 && (
            <p
              data-testid="mobile-launcher-empty"
              className="px-4 py-6 text-center text-sm"
              style={{ color: 'var(--ag-text-muted)' }}
            >
              {t('mobile.launcher.empty')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
