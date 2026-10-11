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
import { useMobileRecentsStore } from '@/store/mobile-recents-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useWindowStore } from '@/store/window-store'
import { getAppManifest } from '@/store/app-store'
import { useEdgeBack } from '@/mobile/gesture/use-edge-back'

/**
 * 移动应用宿主（M1-6 MobileAppHost / M3-2 最近任务重推演，HANDOFF §4.0）：
 * 把 mobile-nav-store 的 `openApp` 从纯导航状态升级为真实全屏应用——view =
 * 'app' 时以显式全屏几何（device-store viewport，x=0 y=0 全宽高，绕开
 * launch.ts 的桌面级联/工作区数学）调 `launchApp(appId, geometry, 'user')`，
 * 返回的 windowId 记入 nav store；返回 null（manifest 缺席 / 权限门禁拒绝）
 * 直接回 home——permission.denied 事件由既有 notification-bridge（main.tsx
 * 装配链）转通知，不造新机制。**不新建 App Runtime**：窗口生命周期仍归
 * window-store（单一事实源），app.started/stopped 由 systemAppLifecycle 从
 * window.created/closed 派生（`core/runtime/app-lifecycle.ts`）。
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
 * 窗口生命周期绑定（M3-2 重推演：**窗口与视图解耦**，本组件仍是唯一的
 * window-store 执行者，store 不反向依赖 UI）：
 * - **启动链不变**：view='app' 且 windowId 尚未落地 → launchApp（openApp
 *   命中活记录时 nav 直接携带已有 windowId，本 effect 不触发——单实例切换
 *   不重开，从最近任务/网格/Dock 再进同一应用都是切回）；
 * - **关窗链改由记录驱动**：M1-6 的「离开宿主位即关窗」退役（窗口常驻是
 *   最近任务的前提），改为订阅 nav store 的 apps 记录 diff——closeApp /
 *   closeAllApps 从记录里移除的 windowId 立即 `useWindowStore.close`
 *   （app.stopped 派生保持正确）；window-store open 恒新开（无去重），
 *   记录 upsert（setAppWindow）保证一个 appId 至多一条活记录；
 * - **僵尸哨兵扩展**：window-store 查无此窗的记录随时修剪——宿主位记录被
 *   剪 → nav 回 home（M1-6 既有语义）；后台记录被剪（羽化举报编排器关
 *   后台窗等）→ 最近任务卡片不显示死窗。closeApp 是纯状态，剪枝路径里
 *   窗口已不在，关窗订阅对缺失窗口 engine.close 幂等无害。
 *
 * 浏览器返回键（PRD §24.2 移动导航 + M3-2 覆盖层层级）：进入应用视图
 * pushState 一条同文档栈位，popstate 触发 backToHome——返回键落在我们的
 * 栈位上消化掉，**不把用户退出 AgehaOS**；最近任务覆盖层打开时再压一条
 * 自己的栈位，popstate **先关覆盖层**（覆盖层栈位被消化，应用栈位不受
 * 影响——否则会把应用的栈位花在关层上，应用视图失去返回保护）；UI 关闭
 * 不调 history.back（避免双跳），残留栈位只会在同文档内移动，不会退出
 * 页面（M1-6 同款口径）。popstate 消费者唯一 = 本组件（依赖 nav +
 * recentsOpen 双档激活），不与覆盖层组件各挂各的监听。
 *
 * 过渡动效（DESIGN.md §35.5）：进出 200ms transform/opacity（既有 token
 * --ag-motion-base，档带 160–220ms 内）；prefers-reduced-motion 由全局
 * 0.01ms 塌缩承接（index.css，不建第二套开关）；motion-prefs 的「窗口切换
 * 转场」档（Settings → 流畅度，useMotionPrefsStore.windowTilt——现有唯一
 * 转场开关）关闭时走 .mobile-app-static 直切。退场用「渲染滞后一拍」：
 * home 立即显示，应用面板带 data-state='leaving' 播完退场再卸载（期间
 * pointer-events-none + aria-hidden，不挡交互不进可达树）。窗口常驻不改变
 * 退场帧语义：面板卸载的是「视图」，窗口仍在 store 里等最近任务切回。
 *
 * 边缘返回手势（M2-4，HANDOFF §4.0-4）：view='app' 时在宿主面板挂
 * useEdgeBack（src/mobile/gesture/use-edge-back.ts）——左缘 ≤24px 起点的
 * 横向拖拽跟手滑入，过半或快速甩动确认，确认走 backToHome（与返回键/
 * popstate 同一出口，不绕过 nav store，HANDOFF §4.0-4「手势返回也应走
 * backToHome」）。跟手动画的降级开关与本组件转场同一档：motion-prefs
 * windowTilt 关 → followMotion=false 直切；prefers-reduced-motion 由 hook
 * 在 pointerdown 时实时探测。冲突审计（2026-10-09 修订，QA 实测纠偏）：
 * `.mobile-app-body` 只声明 overflow-y:auto（index.css），但 CSS 的
 * visible/auto 配对规则会把 x 轴也算成 auto——应用内容 min-content 超出
 * 视口时宿主面板自身就是横向滚动面（QA 实测 Files 在 360px 视口
 * scrollWidth=796），这类面 grep src/apps 抓不到。横向交互的归属：宿主
 * 面板子树 touch-action 默认 pan-y（index.css），真横向滚动面必须收进
 * 显式标记 data-no-edge-back 的容器（hook 整体豁免 + index.css 对该面及
 * 后代重放 pan-x）；首个消费方 = Files 工具栏行（容器查询窄分支，
 * src/apps/files/FileManager.tsx，M2-5 窄容器适配时新增横向面照此办理）。
 * Type B/羽化应用是 sandbox iframe，指针事件天然不达宿主文档，最近任务等
 * Bottom Sheet 是 z-20 覆盖层、按下落在覆盖层元素上不经过本面板。
 */

/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const APP_TRANSITION_MS = 200

export function MobileAppHost() {
  const { t } = useTranslation()
  const nav = useMobileNavStore((state) => state.nav)
  const backToHome = useMobileNavStore((state) => state.backToHome)
  // 窗口切换转场档（motion-prefs）：关档 = 视图直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((state) => state.windowTilt)
  // 最近任务覆盖层开合（M3-2）：popstate 层级的第二激活档（见下）。
  const recentsOpen = useMobileRecentsStore((state) => state.open)

  const inApp = nav.view === 'app'

  // ── 边缘返回手势（M2-4）：挂在宿主面板元素上，view='app' 时启用 ────────
  //    确认 = backToHome（与返回键/popstate 同一出口）；跟手动画跟随转场
  //    档（windowTilt），reduced-motion 由 hook 落下时实时探测。
  const hostRef = useRef<HTMLElement | null>(null)
  useEdgeBack({
    targetRef: hostRef,
    enabled: inApp,
    followMotion: transitionsOn,
    onConfirm: backToHome,
  })

  // ── 窗口生命周期绑定 ①：记录移除 → 关窗（M3-2）────────────────────
  //    closeApp/closeAllApps 移除的 windowId 立即关窗（app.stopped 派生
  //    正确）；M1-6 的「离开宿主位即关窗」随窗口常驻退役。挂载一次的
  //    订阅（本组件在 Shell 里常驻，面板只是其渲染产物）。
  useEffect(() => {
    return useMobileNavStore.subscribe((state, prev) => {
      if (state.apps === prev.apps) return
      const kept = new Set(state.apps.map((app) => app.windowId))
      for (const app of prev.apps) {
        if (!kept.has(app.windowId)) useWindowStore.getState().close(app.windowId)
      }
    })
  }, [])

  // ── 窗口生命周期绑定 ②：僵尸窗口哨兵（M1-6 语义 + M3-2 后台记录扩展）──
  //    window-store 查无此窗的记录随时修剪：宿主位被剪 → nav 回 home（防
  //    渲染僵尸 windowId）；后台被剪 → 最近任务卡片不显示死窗。
  useEffect(() => {
    const reconcile = (): void => {
      const { apps, closeApp } = useMobileNavStore.getState()
      if (apps.length === 0) return
      const ids = new Set(useWindowStore.getState().windows.map((win) => win.id))
      for (const app of apps) {
        if (!ids.has(app.windowId)) closeApp(app.windowId)
      }
    }
    reconcile()
    return useWindowStore.subscribe(reconcile)
  }, [])

  // ── 退场渲染滞后：app → home 时保留最后一帧应用面板 200ms 播退场 ──────
  const prevNavRef = useRef(nav)
  const [leaving, setLeaving] = useState<{ appId: string; windowId: string | null } | null>(null)
  useEffect(() => {
    const prev = prevNavRef.current
    prevNavRef.current = nav
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

  // ── 浏览器返回键：popstate 消费者唯一，双档激活（app 视图 / 覆盖层打开）─
  const pushedAppRef = useRef<string | null>(null)
  const pushedRecentsRef = useRef(false)
  useEffect(() => {
    if (nav.view !== 'app' && !recentsOpen) {
      pushedAppRef.current = null
      pushedRecentsRef.current = false
      return
    }
    // 每次进入应用视图压一条同文档栈位；同一应用在栈上的连续帧（补记
    // windowId 等）不重复压。StrictMode 双跑由 ref 挡住（同一实例）。
    if (nav.view === 'app' && pushedAppRef.current !== nav.appId) {
      pushedAppRef.current = nav.appId
      window.history.pushState({ agehaMobileApp: nav.appId }, '')
    }
    // 最近任务覆盖层（M3-2）：打开时压自己的栈位——返回键先关覆盖层，
    // 应用自身的栈位不被花掉（层级见模块注释）。
    if (recentsOpen && !pushedRecentsRef.current) {
      pushedRecentsRef.current = true
      window.history.pushState({ agehaMobileRecents: true }, '')
    }
    if (!recentsOpen) pushedRecentsRef.current = false
    const onPopState = (): void => {
      // 层级 ①：覆盖层在场上 → 返回键只关覆盖层（栈位已被本次返回消化，
      // 不再 history.back——双跳禁令，M1-6 同款）。
      if (useMobileRecentsStore.getState().open) {
        useMobileRecentsStore.getState().closeRecents()
        return
      }
      // 层级 ②：返回键只消化「退出应用视图」——回 home，不退出 AgehaOS；
      // 窗口常驻（M3-2），app 仍在最近任务里可切回。
      if (useMobileNavStore.getState().nav.view === 'app') {
        useMobileNavStore.getState().backToHome()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [nav, recentsOpen])

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
      ref={hostRef}
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
          实色底不加 blur——玻璃白名单五处（§35.1）不含应用 header。
          M3-2：返回 = 回 Home（窗口保留，应用可在最近任务切回）。 */}
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
