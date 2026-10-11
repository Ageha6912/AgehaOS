import { useRef } from 'react'

import { House } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useAppStore } from '@/store/app-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useMobileRecentsStore } from '@/store/mobile-recents-store'

import { useDockHomeGesture } from './use-dock-home-gesture'
import { MOBILE_DOCK_APP_IDS } from '../shared/mobile-dock-slots'

/**
 * 移动 Dock（M1-5，HANDOFF §4.0-6「填充 mobile-dock-slot 上方」/ M3-2
 * Home 位扩展）：固定 5 位——Home（Phosphor House 字形，短按
 * mobile-nav-store.backToHome；**长按或上滑打开最近任务**，M3-2）+
 * Files / Notes / 今日世界（dynamic.panel）/ Settings（动作 openApp）。
 *
 * 共享与独立（ARCHITECTURE.md §3.25 复用边界）：
 * - 共享：应用元数据（appDisplayName 本地化展示名，与桌面启动器同源）、
 *   图标（AppIcon 徽章体系）、注册表（app-store）与启动语义
 *   （mobile-nav-store.openApp——与 Home 其余入口同一过渡语义，M1-6
 *   AppHost 升级为真实启动）；
 * - 独立：UI 与桌面 Dock（Taskbar）零共享——无波浪/悬停预览/回收站/运行中
 *   窗口列（触屏本无 hover，桌面 A21 指针语义不带入）。
 *
 * 当前位高亮：view === 'app' 且 appId 匹配该位时亮 primary 指示条（桌面
 * Dock 同一 Active 指示语言，2px×16px 细条，primary = Active/Selected
 * 配额）；Home 位不参与高亮——view = 'home' 是 Dock 与 Home 层同屏的
 * 常态，恒亮等于没有状态（切片口径只钉 appId 匹配档）。
 *
 * M3-2 Home 位三动作：短按 = 回 Home（原生 click，手势 hook 不拦截）；
 * 长按/上滑 = mobile-recents-store.openRecents（最近任务覆盖层唯一入口，
 * 手势判定与冲突防护见 use-dock-home-gesture / dock-home-gesture）。**空
 * 态整层不可达的入口档**在本组件：无已开应用（nav store apps 为空）时
 * 长按/上滑不分发——可点元素必须有真实状态响应，入口不为空壳层开门。
 * 按钮带 `[data-no-edge-back]`（手势家族逃生口）：起于 Home 位的手势归
 * 本位手势，M3-1 的 zone 级上滑在此起点让位（Dock 其余区域上滑仍是
 * Launcher）；`select-none` 压掉长按的文本选择 callout。
 *
 * 防御位（禁止死按钮优先于「固定 5 位」）：四位应用全部为 boot 内置注册，
 * 实践中恒在册；万一不在册（理论卸载路径）该位不渲染——可点元素必须有
 * 真实状态响应，不渲染点了没反应的死瓦片。
 *
 * 视觉（DESIGN.md §35）：玻璃白名单五处之一的 Dock 位（§35.1）——唯一
 * 一层玻璃 = surface-glass 基底 + glass-raise（blur 20px raise 档，与桌面
 * 窄轨同档），清单外零 blur；safe-area bottom 仍由 mobile-dock-slot 预留带
 * 承担（M0-4 契约不变，本组件坐在带上方，不读 env 不加纵向 padding）；
 * 每格命中区 ≥44×44px（§35.3）；文案只有地标名与 Home 位名走 i18n 双词典
 * （§35.6），应用名是 appDisplayName 数据。
 */
export function MobileDock() {
  const { t } = useTranslation()
  const nav = useMobileNavStore((state) => state.nav)
  const openApp = useMobileNavStore((state) => state.openApp)
  const backToHome = useMobileNavStore((state) => state.backToHome)
  // M3-2：已开应用数（入口档的空态判定）+ 最近任务开合。
  const openAppCount = useMobileNavStore((state) => state.apps.length)
  const openRecents = useMobileRecentsStore((state) => state.openRecents)
  // 注册表版本订阅：apps 数组引用随每次 commit 更新，卸载即刻重渲染重跑
  // 在册过滤（与 RecentApps 的 apps 订阅同口径）。
  const apps = useAppStore((state) => state.apps)
  const registeredIds = new Set(apps.map((app) => app.id))
  const slots = MOBILE_DOCK_APP_IDS.filter((appId) => registeredIds.has(appId))

  // Home 位手势（M3-2）：长按/上滑开最近任务；空态整层不可达——入口在
  // 本组件按 openAppCount 放行（见模块注释）。
  const homeRef = useRef<HTMLButtonElement | null>(null)
  const openRecentsIfAny = (): void => {
    if (openAppCount === 0) return
    openRecents()
  }
  useDockHomeGesture({
    targetRef: homeRef,
    onLongPress: openRecentsIfAny,
    onSwipeUp: openRecentsIfAny,
  })

  return (
    <nav
      data-testid="mobile-dock"
      aria-label={t('mobile.dock.label')}
      className="surface-glass glass-raise shrink-0 border-t"
      style={{ borderColor: 'var(--ag-border-subtle)' }}
    >
      <ul
        data-testid="mobile-dock-list"
        className="flex items-stretch justify-around px-2 py-1.5"
      >
        <li>
          <button
            type="button"
            ref={homeRef}
            data-testid="mobile-dock-home"
            data-no-edge-back
            aria-label={t('mobile.dock.home')}
            onClick={backToHome}
            className="flex min-h-[44px] min-w-[44px] select-none items-center justify-center rounded-xl px-1 py-1 transition-opacity active:opacity-80"
          >
            {/* 中性瓷贴：与 AppIcon 徽章同几何（rounded-[24%] + 白细环），
                实色 --ag-surface-raised 底区别于应用渐变徽章——Home 是
                Shell 动作不是应用，不进应用徽章体系、不造第二个「图标」。 */}
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-[24%] shadow-[0_1px_2px_rgba(15,23,42,0.25)] ring-1 ring-inset ring-white/25"
              style={{ backgroundColor: 'var(--ag-surface-raised)' }}
            >
              <House size={24} weight="fill" style={{ color: 'var(--ag-text)' }} />
            </span>
          </button>
        </li>
        {slots.map((appId) => {
          const active = nav.view === 'app' && nav.appId === appId
          return (
            <li key={appId}>
              <button
                type="button"
                data-testid="mobile-dock-app"
                data-app-id={appId}
                aria-label={appDisplayName(appId)}
                aria-current={active ? 'true' : undefined}
                onClick={() => openApp(appId)}
                className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-1 py-1 transition-opacity active:opacity-80"
              >
                {/* AppIcon 无 label = 装饰位（aria-hidden），可访问名由
                    aria-label 承担——与桌面 Dock 瓷贴同口径（读屏名称恒为
                    应用名，不随状态漂移）。 */}
                <AppIcon appId={appId} size={44} />
                {active && (
                  // 当前位指示条：桌面 Dock 同一 Active 指示语言（2px×16px
                  // primary 细条）；bottom-0 落在按钮 py-1 内边距带，不压徽章。
                  <span
                    aria-hidden="true"
                    data-testid="mobile-dock-active-indicator"
                    className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-primary"
                  />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
