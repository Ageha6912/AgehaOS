import { useEffect, useRef, useState } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { MissingApp } from '@/apps/placeholder-app'
import { appDisplayName, launchApp } from '@/apps/launch'
import { isAllowedWebAppEntry } from '@/core/apps/web-app'
import { isEclosionAppId } from '@/core/eclosion/spec'
import { useTranslation } from '@/core/i18n'
import { CaretLeft } from '@phosphor-icons/react'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { EclosionAppFrame } from '@/components/eclosion-app-frame'
import { WebAppFrame } from '@/components/web-app-frame'
import { useDeviceStore } from '@/store/device-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useWindowStore } from '@/store/window-store'
import { getAppManifest } from '@/store/app-store'

/**
 * 移动应用宿主（M1-6 MobileAppHost，HANDOFF §4.0-7）：把 mobile-nav-store
 * 的 `openApp` 从纯导航状态升级为真实全屏应用——view = 'app' 时以显式全屏
 * 几何（device-store viewport，x=0 y=0 全宽高，绕开 launch.ts 的桌面级联/
 * 工作区数学）调 `launchApp(appId, geometry, 'user')`，返回的 windowId 记入
 * nav store；返回 null（manifest 缺席 / 权限门禁拒绝）直接回 home——
 * permission.denied 事件由既有 notification-bridge（main.tsx 装配链）转通知，
 * 不造新机制。**不新建 App Runtime**：窗口生命周期仍归 window-store（单一
 * 事实源），app.started/stopped 由 systemAppLifecycle 从 window.created/
 * closed 派生（backToHome 关窗即保证派生正确）。
 *
 * 内容路由与桌面 WindowFrame.tsx 同序（复用边界，ARCHITECTURE.md §3.25
 * 「能力复用、容器不复用」）：`componentFor(appId)`（APP_UI_META 内置组件）
 * → `isEclosionAppId` 分支挂 EclosionAppFrame（挂载参数对照
 * WindowFrame.tsx:305-309，且该分支必须先于 Type B 判定——runner entry 不在
 * /apps/sites/ 内）→ Type B 同源站点 WebAppFrame（allowlist 判定同款）→
 * MissingApp。内容外层包 AppErrorBoundary（崩溃隔离 + app.crashed 事件）+
 * `.mobile-app-body` overflow 滚动容器（应用自己不带滚动容器），header 之外
 * 不渲染 WindowFrame 任何桌面 chrome。
 *
 * 窗口生命周期绑定（本组件持有宿主位，store 不反向依赖 UI）：
 * - 离开宿主位（backToHome / 切换 appId）→ 立即 `useWindowStore.close` 该
 *   窗口——移动应用视图 = 单窗口生命周期与视图同生共死；window-store 既有
 *   行为是「open 永远新开」（WindowManager.create 无去重/复用），因此从
 *   home 再次进入同一应用自然得到新窗口（复用语义无从谈起），同视图内重复
 *   点击同一 appId 则由 nav store 的等值跳过天然去重，不重复 launch；
 * - 宿主窗口被外部关闭（羽化举报链路的编排器关窗等）→ 视图跟随回 home，
 *   防止渲染僵尸 windowId。
 *
 * 浏览器返回键（PRD §24.2 移动导航）：进入应用视图 pushState 一条同文档
 * 栈位，popstate 触发 backToHome——返回键落在我们的栈位上消化掉，**不把
 * 用户退出 AgehaOS**；UI 返回不调 history.back（避免双跳），残留栈位只会在
 * 同文档内移动，同样不会离开页面。
 *
 * 过渡动效（DESIGN.md §35.5）：进出 200ms transform/opacity（既有 token
 * --ag-motion-base，档带 160–220ms 内）；prefers-reduced-motion 由全局
 * 0.01ms 塌缩承接（index.css，不建第二套开关）；motion-prefs 的「窗口切换
 * 转场」档（Settings → 流畅度，useMotionPrefsStore.windowTilt——现有唯一
 * 转场开关）关闭时走 .mobile-app-static 直切。退场用「渲染滞后一拍」：
 * home 立即显示，应用面板带 data-state='leaving' 播完退场再卸载（期间
 * pointer-events-none + aria-hidden，不挡交互不进可达树）。
 */

/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const APP_TRANSITION_MS = 200

export function MobileAppHost() {
  const { t } = useTranslation()
  const nav = useMobileNavStore((state) => state.nav)
  const backToHome = useMobileNavStore((state) => state.backToHome)
  // 窗口切换转场档（motion-prefs）：关档 = 视图直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((state) => state.windowTilt)

  const inApp = nav.view === 'app'

  // ── 离开宿主位：关窗 + 退场渲染滞后（声明先于启动 effect，同一 commit
  //    内先关旧窗再启新窗）──────────────────────────────────────────────
  const prevNavRef = useRef(nav)
  const [leaving, setLeaving] = useState<{ appId: string; windowId: string | null } | null>(null)
  useEffect(() => {
    const prev = prevNavRef.current
    prevNavRef.current = nav

    // ① 窗口生命周期绑定：不再被 nav 引用的宿主窗口立即关闭（回 home /
    //    切换 appId）。同 windowId 视为仍在宿主位（setAppWindow 补记帧）。
    if (prev.view === 'app' && prev.windowId !== null) {
      const stillHosted = nav.view === 'app' && nav.windowId === prev.windowId
      if (!stillHosted) useWindowStore.getState().close(prev.windowId)
    }

    // ② 退场动画滞后：app → home 时保留最后一帧应用面板 200ms 播退场，
    //    home 立即可见可交互（面板只叠加淡出）。
    if (nav.view === 'app') {
      setLeaving(null)
      return
    }
    if (prev.view !== 'app') return
    setLeaving({ appId: prev.appId, windowId: prev.windowId })
    const timer = window.setTimeout(() => setLeaving(null), APP_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [nav])

  // ── 真实启动：view = 'app' 且 windowId 尚未落地 → launchApp ────────────
  useEffect(() => {
    if (nav.view !== 'app' || nav.windowId !== null) return
    // 双跑/竞态守卫：live store 已有窗口实例接管（StrictMode 二次执行等）
    // 时不再 launch——以 store 为准，不以本次渲染快照为准。
    const live = useMobileNavStore.getState()
    if (live.nav.view !== 'app' || live.nav.windowId !== null) return
    // 显式全屏几何（device-store viewport，x=0 y=0 全宽高）：绕开 launch.ts
    // 的桌面级联居中与工作区钳制；source='user' 记入最近使用（usage-store）。
    const { viewportWidth, viewportHeight } = useDeviceStore.getState().capabilities
    const launched = launchApp(
      live.nav.appId,
      { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
      'user',
    )
    if (launched === null) {
      // 权限门禁拒绝 / manifest 缺席：直接回 home（permission.denied 已由
      // notification-bridge 消费，不造新机制）。
      useMobileNavStore.getState().backToHome()
      return
    }
    useMobileNavStore.getState().setAppWindow(launched)
  }, [nav])

  // ── 僵尸窗口哨兵：宿主窗口被外部关闭（羽化举报等编排器链路）→ 回 home ──
  const hostedId = inApp ? nav.windowId : null
  useEffect(() => {
    if (hostedId === null) return
    const reconcile = (): void => {
      if (useWindowStore.getState().windows.some((win) => win.id === hostedId)) return
      const live = useMobileNavStore.getState()
      if (live.nav.view === 'app' && live.nav.windowId === hostedId) live.backToHome()
    }
    reconcile()
    return useWindowStore.subscribe(reconcile)
  }, [hostedId])

  // ── 浏览器返回键：进应用 pushState 一条，popstate → backToHome ─────────
  const pushedAppRef = useRef<string | null>(null)
  useEffect(() => {
    if (nav.view !== 'app') {
      pushedAppRef.current = null
      return
    }
    // 每次进入应用视图压一条同文档栈位；同一应用在栈上的连续帧（补记
    // windowId 等）不重复压。StrictMode 双跑由 ref 挡住（同一实例）。
    if (pushedAppRef.current !== nav.appId) {
      pushedAppRef.current = nav.appId
      window.history.pushState({ agehaMobileApp: nav.appId }, '')
    }
    const onPopState = (): void => {
      // 返回键只消化「退出应用」：回 home，不退出 AgehaOS。
      if (useMobileNavStore.getState().nav.view === 'app') {
        useMobileNavStore.getState().backToHome()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [nav])

  // ── 渲染：home 态退场滞后已结束 → 不渲染；否则渲染当前/退场面板 ────────
  const panel =
    nav.view === 'app'
      ? { appId: nav.appId, windowId: nav.windowId }
      : leaving !== null
        ? { appId: leaving.appId, windowId: leaving.windowId }
        : null
  if (panel === null) return null

  const displayName = appDisplayName(panel.appId)
  const meta = componentFor(panel.appId)
  // 内容只在「live 宿主 + 窗口已落地」时挂载：退场帧与启动过渡帧只有
  // header 骨架（窗口此刻已关/未建，绝不渲染僵尸 AppErrorBoundary）。
  const liveWindowId = nav.view === 'app' && nav.windowId !== null ? nav.windowId : null

  return (
    <section
      data-testid="mobile-app-host"
      data-app-id={panel.appId}
      data-window-id={inApp ? (nav.windowId ?? '') : undefined}
      data-state={inApp ? 'open' : 'leaving'}
      aria-label={displayName}
      aria-hidden={inApp ? undefined : true}
      className={`mobile-app-host absolute inset-0 z-10 flex flex-col ${
        transitionsOn ? '' : 'mobile-app-static'
      }`}
    >
      {/* 应用 header：返回 + 图标 + 应用名（appDisplayName 本地化展示名，
          与桌面窗口标题同源）。返回键命中区 44×44（DESIGN.md §35.3）。
          实色底不加 blur——玻璃白名单五处（§35.1）不含应用 header。 */}
      <header
        data-testid="mobile-app-header"
        className="flex h-12 shrink-0 items-center gap-1 border-b px-1.5"
        style={{ borderColor: 'var(--ag-border-subtle)' }}
      >
        <button
          type="button"
          data-testid="mobile-app-back"
          aria-label={t('mobile.apphost.back')}
          onClick={backToHome}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-opacity active:opacity-80"
        >
          <CaretLeft size={22} weight="bold" aria-hidden="true" style={{ color: 'var(--ag-text)' }} />
        </button>
        <AppIcon appId={panel.appId} size={20} />
        <span
          data-testid="mobile-app-title"
          className="min-w-0 truncate text-sm font-semibold"
          style={{ color: 'var(--ag-text)' }}
        >
          {displayName}
        </span>
      </header>
      {/* 内容滚动容器：应用自己不带滚动容器（WindowFrame 同口径——桌面是
          窗口体 overflow-auto，移动是本容器），纵向超出在此滚动。 */}
      <div data-testid="mobile-app-body" className="mobile-app-body flex-1">
        {liveWindowId !== null && (
          <AppErrorBoundary appId={panel.appId} windowId={liveWindowId}>
            {meta ? (
              <meta.Component windowId={liveWindowId} />
            ) : isEclosionAppId(panel.appId) ? (
              // 羽化前缀分支（AI-GENERATED-APPS-DESIGN §3.2）：必须先于
              // Type B 的 allowlist 判定（WindowFrame.tsx:305-309 同序同参）。
              <EclosionAppFrame appId={panel.appId} windowId={liveWindowId} title={displayName} />
            ) : (
              <MobileTypeBOrMissing appId={panel.appId} windowId={liveWindowId} title={displayName} />
            )}
          </AppErrorBoundary>
        )}
      </div>
    </section>
  )
}

/**
 * Type B（同源静态站点）兜底路由——桌面 WindowFrame.tsx 的 TypeBOrMissing
 * 移动同款（逻辑零改动复制，不 import 桌面容器）：manifest entry 通过
 * /apps/sites/ allowlist（§30.3 第二道闸）才挂 WebAppFrame，否则 MissingApp。
 */
function MobileTypeBOrMissing({
  appId,
  windowId,
  title,
}: {
  appId: string
  windowId: string
  title: string
}) {
  const registered = getAppManifest(appId)
  if (registered && isAllowedWebAppEntry(registered.entry)) {
    return <WebAppFrame entry={registered.entry} appId={appId} windowId={windowId} title={title} />
  }
  return <MissingApp windowId={windowId} />
}
