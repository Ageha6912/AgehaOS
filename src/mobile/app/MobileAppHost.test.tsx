import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { installApp, resetAppStore } from '@/store/app-store'
import { permissionManager } from '@/core/permissions'
import { resetDeviceStore, useDeviceStore } from '@/store/device-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetMobileRecentsStore, useMobileRecentsStore } from '@/store/mobile-recents-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { MobileAppHost } from './MobileAppHost'

/**
 * M1-6 移动应用宿主契约（jsdom 单测；几何语义的真实视口归 E2E
 * e2e/mobile-app-host.spec.ts）：
 * - view='app' 真实 launchApp：显式全屏几何（device-store viewport，x=0 y=0
 *   全宽高）、windowId 记入 nav store、source='user' 记入最近使用；
 * - 生命周期绑定（M3-2 重推演：窗口与视图解耦）：回 home / 切换视图不再
 *   关窗（窗口常驻 = 最近任务的前提）；关窗由 apps 记录移除驱动
 *   （closeApp/closeAllApps 的订阅执行，app.started/stopped 派生正确的
 *   根基）；单实例切回（openApp/switchToApp 指向已有 windowId）不重新
 *   launchApp；外部关窗（僵尸哨兵）宿主位回 home、后台位剪记录；
 * - 拒绝路径：launchApp 返回 null（权限门禁）自动回 home，不开窗；
 * - 浏览器返回键：进应用 pushState 一条同文档栈位，popstate → backToHome
 *   （不退出 AgehaOS）；最近任务覆盖层打开时先关覆盖层（popstate 消费者
 *   唯一 = 本组件）；home 态 popstate no-op；
 * - 内容路由与桌面 WindowFrame 同序：APP_UI_META → 羽化前缀 → Type B
 *   allowlist → MissingApp（EclosionAppFrame/WebAppFrame 以 stub 替身参与
 *   路由断言，重型 iframe 机制各有自有单测）；
 * - 动效档：motion-prefs 窗口切换转场关档 → .mobile-app-static 直切。
 */

vi.mock('@/components/eclosion-app-frame', () => ({
  EclosionAppFrame: (props: { appId: string; windowId: string; title: string }) => (
    <div
      data-testid="eclosion-frame-stub"
      data-app-id={props.appId}
      data-window-id={props.windowId}
      data-title={props.title}
    />
  ),
}))

vi.mock('@/components/web-app-frame', () => ({
  WebAppFrame: (props: { entry: string; appId: string; windowId: string; title: string }) => (
    <div
      data-testid="web-frame-stub"
      data-entry={props.entry}
      data-app-id={props.appId}
      data-window-id={props.windowId}
    />
  ),
}))

/** 注册一个 Type B 形态的最小 manifest（entry 在 /apps/sites/ allowlist 内）。 */
function installTypeBApp(id: string): void {
  const result = installApp({
    id,
    name: 'Sites Demo',
    version: '1.0.0',
    entry: '/apps/sites/demo/index.html',
  })
  expect(result.ok).toBe(true)
}

beforeEach(() => {
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetMobileNavStore()
  resetMobileRecentsStore()
  resetUsageStore()
  resetDeviceStore()
})

afterEach(() => {
  useLocaleStore.setState(useLocaleStore.getInitialState())
  useMotionPrefsStore.setState(useMotionPrefsStore.getInitialState())
})

describe('MobileAppHost', () => {
  it('home 视图不渲染宿主面板', () => {
    render(<MobileAppHost />)
    expect(screen.queryByTestId('mobile-app-host')).not.toBeInTheDocument()
  })

  it('view=app 真实 launchApp：全屏几何 + windowId 记入 nav + 最近使用（user 来源）', () => {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    const host = screen.getByTestId('mobile-app-host')
    expect(host).toHaveAttribute('data-app-id', 'com.ageha.calculator')
    expect(host).toHaveAttribute('data-state', 'open')

    // 窗口真实落地：显式全屏几何 = device-store viewport（x=0 y=0 全宽高）。
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    const { viewportWidth, viewportHeight } = useDeviceStore.getState().capabilities
    expect(windows[0]?.appId).toBe('com.ageha.calculator')
    expect(windows[0]?.x).toBe(0)
    expect(windows[0]?.y).toBe(0)
    expect(windows[0]?.width).toBe(viewportWidth)
    expect(windows[0]?.height).toBe(viewportHeight)

    // windowId 记入 nav store 并反射在面板上。
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.calculator',
      windowId: windows[0]?.id,
    })
    expect(host).toHaveAttribute('data-window-id', windows[0]?.id)

    // header：返回键（i18n 可访问名 + 44px 命中区类）+ 应用名（titleKey 本地化）。
    expect(screen.getByTestId('mobile-app-back')).toHaveAttribute('aria-label', '返回')
    expect(screen.getByTestId('mobile-app-back')).toHaveClass('h-11', 'w-11')
    expect(screen.getByTestId('mobile-app-title')).toHaveTextContent('计算器')

    // source='user'：最近使用已记录（usage-store 单一来源）。
    expect(useUsageStore.getState().recent[0]?.appId).toBe('com.ageha.calculator')
  })

  it('header 返回键：backToHome，窗口保留（M3-2 视图与窗口解耦），退场帧播完卸载', async () => {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })
    const windowId = useWindowStore.getState().windows[0]?.id
    expect(windowId).toBeDefined()

    fireEvent.click(screen.getByTestId('mobile-app-back'))

    // 视图复位但窗口常驻（app 可在最近任务切回；app.stopped 不派生——
    // 窗口还开着，派生语义保持正确）。
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useMobileNavStore.getState().apps.map((app) => app.windowId)).toEqual([windowId])

    // 退场帧：面板保留一拍（data-state='leaving'，只有 header 骨架，
    // 不渲染窗口内容），随后卸载——卸载的是视图，不是窗口。
    const leaving = screen.getByTestId('mobile-app-host')
    expect(leaving).toHaveAttribute('data-state', 'leaving')
    expect(leaving).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByTestId('mobile-app-body')).toBeEmptyDOMElement()
    await waitFor(
      () => expect(screen.queryByTestId('mobile-app-host')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
  })

  it('launchApp 拒绝（权限门禁）→ 自动回 home，不开窗', async () => {
    permissionManager.revoke('com.ageha.notes', 'storage')
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.notes')
    })

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(useWindowStore.getState().windows).toHaveLength(0)
    // 未落地窗口 → 无 live 内容帧；面板只留一拍退场帧后卸载。
    await waitFor(
      () => expect(screen.queryByTestId('mobile-app-host')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
  })

  it('视图内重复 openApp 同一 appId：等值跳过，不重复开窗', () => {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('视图内切换应用：旧窗保留 + 新窗启动（M3-2 多已开 App View 并存）', () => {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })
    const firstWindowId = useWindowStore.getState().windows[0]?.id
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.notes')
    })

    // 旧窗常驻 + 新窗落地：两窗口并存，各自有记录（最近任务的数据面）。
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(2)
    expect(windows.map((win) => win.id)).toContain(firstWindowId)
    const notesWindowId = windows.find((win) => win.id !== firstWindowId)?.id
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: notesWindowId,
    })
    expect(useMobileNavStore.getState().apps.map((app) => app.windowId).sort()).toEqual(
      [firstWindowId, notesWindowId].sort(),
    )
  })

  it('浏览器返回键：进应用 pushState 一条，popstate → backToHome（不退出 AgehaOS）', () => {
    render(<MobileAppHost />)
    const lengthBefore = window.history.length
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    // 同文档栈位已压入，URL 不变（不导航不退出）。
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(window.history.state?.agehaMobileApp).toBe('com.ageha.calculator')
    const hrefBefore = window.location.href

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    // M3-2：窗口常驻——返回键退出的是视图，窗口留在最近任务里。
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(window.location.href).toBe(hrefBefore)
  })

  it('home 态 popstate：no-op（不产生导航副作用）', () => {
    render(<MobileAppHost />)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('僵尸窗口哨兵：宿主窗口被外部关闭 → 视图自动回 home + 记录修剪', () => {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })
    const windowId = useWindowStore.getState().windows[0]?.id
    expect(windowId).toBeDefined()

    // 外部关窗（羽化举报链路的编排器关窗等）：窗口消失，视图跟随。
    act(() => {
      useWindowStore.getState().close(windowId!)
    })
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    // M3-2：记录同步修剪（最近任务卡片不显示死窗）。
    expect(useMobileNavStore.getState().apps).toEqual([])
  })

  it('内容路由：APP_UI_META 内置组件优先（计算器真实挂载）', () => {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    // 计算器 = APP_UI_META Type A 真组件（自带本地 UI），非替身路由。
    expect(screen.getByTestId('calculator-display')).toBeInTheDocument()
    expect(screen.queryByTestId('eclosion-frame-stub')).not.toBeInTheDocument()
    expect(screen.queryByTestId('web-frame-stub')).not.toBeInTheDocument()
  })

  it('内容路由：羽化前缀分支挂 EclosionAppFrame（先于 Type B 判定，参数同 WindowFrame）', () => {
    installTypeBApp('com.ageha.eclosion.demo')
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.eclosion.demo')
    })

    const windowId = useWindowStore.getState().windows[0]?.id
    const stub = screen.getByTestId('eclosion-frame-stub')
    expect(stub).toHaveAttribute('data-app-id', 'com.ageha.eclosion.demo')
    expect(stub).toHaveAttribute('data-window-id', windowId)
    expect(stub).toHaveAttribute('data-title', 'Sites Demo')
    expect(screen.queryByTestId('web-frame-stub')).not.toBeInTheDocument()
  })

  it('内容路由：Type B allowlist 内 entry 挂 WebAppFrame', () => {
    installTypeBApp('com.ageha.sites.demo')
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.sites.demo')
    })

    const windowId = useWindowStore.getState().windows[0]?.id
    expect(screen.getByTestId('web-frame-stub')).toHaveAttribute(
      'data-entry',
      '/apps/sites/demo/index.html',
    )
    expect(screen.getByTestId('web-frame-stub')).toHaveAttribute('data-window-id', windowId)
  })

  it('内容路由：非 Type A、非羽化、allowlist 外 → MissingApp（同桌面兜底）', () => {
    const result = installApp({
      id: 'com.ageha.plain.demo',
      name: 'Plain Demo',
      version: '1.0.0',
      entry: '/apps/elsewhere/index.html',
    })
    expect(result.ok).toBe(true)
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.plain.demo')
    })

    expect(screen.getByText('未找到该应用，窗口即将关闭。')).toBeInTheDocument()
    expect(screen.queryByTestId('web-frame-stub')).not.toBeInTheDocument()
  })

  it('motion-prefs 窗口切换转场关档：面板追加 .mobile-app-static 直切', () => {
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    expect(screen.getByTestId('mobile-app-host')).toHaveClass('mobile-app-static')
  })

  it('en 档：返回键可访问名走 en 词典（双词典类型对齐）', () => {
    setLocale('en')
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    expect(screen.getByTestId('mobile-app-back')).toHaveAttribute('aria-label', 'Back')
    expect(screen.getByTestId('mobile-app-title')).toHaveTextContent('Calculator')
  })
})

/**
 * M2-4 边缘返回手势集成（判定/降级细节归 gesture 目录单测，这里钉宿主
 * 挂载契约：view='app' 时手势可用、确认 = backToHome 同一出口、跟手动画
 * 跟随转场档、data-no-edge-back 逃生口在宿主树内生效）。
 */
describe('MobileAppHost 边缘返回手势', () => {
  // jsdom 零布局：hook 视口取样回退 window.innerWidth/Height——钉成 360×800
  // 与 E2E 设备档同口径（确认线 = 半屏 180px）。
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 360)
    vi.stubGlobal('innerHeight', 800)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 在面板上驱动一段 pointer 拖拽（bubbles 冒泡到宿主 section）。 */
  function swipeOnHost(
    target: Element,
    points: Array<{ x: number; y: number }>,
    pointerType = 'touch',
  ): void {
    for (const [index, p] of points.entries()) {
      const type = index === 0 ? 'pointerdown' : index === points.length - 1 ? 'pointerup' : 'pointermove'
      act(() => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType,
            clientX: p.x,
            clientY: p.y,
          }),
        )
      })
    }
  }

  function openCalculator(): void {
    render(<MobileAppHost />)
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })
    expect(useWindowStore.getState().windows).toHaveLength(1)
  }

  it('边缘拖过半（非跟手档）：确认 = backToHome 同一出口，窗口保留（M3-2）', async () => {
    // 转场关档 → followMotion=false：零 rAF 依赖，释放即直切。
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    openCalculator()

    swipeOnHost(screen.getByTestId('mobile-app-host'), [
      { x: 10, y: 400 },
      { x: 250, y: 400 },
    ])

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useMobileNavStore.getState().apps).toHaveLength(1)
  })

  it('非边缘起点拖过半：不触发', () => {
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    openCalculator()

    swipeOnHost(screen.getByTestId('mobile-app-host'), [
      { x: 120, y: 400 },
      { x: 340, y: 400 },
    ])

    expect(useMobileNavStore.getState().nav.view).toBe('app')
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('跟手档：拖拽中面板 transform 直写（零 render 跟手），释放过半确认', async () => {
    openCalculator()
    const host = screen.getByTestId('mobile-app-host')
    const pev = (type: string, x: number, y: number): void => {
      act(() => {
        host.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
          }),
        )
      })
    }

    pev('pointerdown', 10, 400)
    pev('pointermove', 160, 400)
    // 真实 rAF（jsdom pretendToBeVisual ~16ms 帧）：等一帧让采样跑完。
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(host.style.transform).toBe('translate3d(150px, 0, 0)')

    pev('pointermove', 250, 400)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(host.style.transform).toBe('translate3d(240px, 0, 0)')

    pev('pointerup', 250, 400)
    // jsdom 无 WAAPI → 瞬时终态：立即确认，样式还原；窗口保留（M3-2）。
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(host.style.transform).toBe('')
  })

  it('data-no-edge-back 标记元素内的起点：手势豁免（横向滚动面逃生口）', () => {
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    openCalculator()
    const backButton = screen.getByTestId('mobile-app-back')
    backButton.setAttribute('data-no-edge-back', '')

    swipeOnHost(backButton, [
      { x: 10, y: 24 },
      { x: 250, y: 24 },
    ])

    expect(useMobileNavStore.getState().nav.view).toBe('app')
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })
})

/**
 * M3-2 最近任务生命周期（数据形状归 mobile-nav-store.test.ts，覆盖层 UI 归
 * MobileRecentsSheet.test.tsx，这里钉 AppHost 作为 window-store 唯一执行者
 * 的三段接线：单实例切回不重开 / 记录移除→关窗 / 后台僵尸剪枝 + popstate
 * 覆盖层层级）。
 */
describe('MobileAppHost 最近任务（M3-2）', () => {
  function openApp(appId: string): string {
    act(() => {
      useMobileNavStore.getState().openApp(appId)
    })
    const nav = useMobileNavStore.getState().nav
    if (nav.view === 'app' && nav.windowId !== null) return nav.windowId
    const win = useWindowStore
      .getState()
      .windows.find((candidate) => candidate.appId === appId)
    expect(win).toBeDefined()
    return win!.id
  }

  it('单实例切回：回 home 再进同一应用 = 指回已有 windowId，不重新 launchApp', () => {
    render(<MobileAppHost />)
    const windowId = openApp('com.ageha.calculator')
    expect(useUsageStore.getState().recent).toHaveLength(1)

    act(() => {
      useMobileNavStore.getState().backToHome()
    })
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.calculator',
      windowId,
    })
    // 窗口不换（无第二次 launch）、usage 只记一次（source='user' 记录随
    // launchApp 走，切回不经过它）。
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().windows[0]?.id).toBe(windowId)
    expect(useUsageStore.getState().recent).toHaveLength(1)
    // 内容真实挂载（calculator-display），不是启动过渡帧。
    expect(screen.getByTestId('mobile-app-host')).toHaveAttribute('data-window-id', windowId)
    expect(screen.getByTestId('calculator-display')).toBeInTheDocument()
  })

  it('switchToApp 切回已有窗口：面板 windowId 跟随、零新窗（最近任务点卡片的服务端）', () => {
    render(<MobileAppHost />)
    const calcId = openApp('com.ageha.calculator')
    const notesId = openApp('com.ageha.notes')
    expect(useWindowStore.getState().windows).toHaveLength(2)

    act(() => {
      useMobileNavStore.getState().switchToApp(calcId)
    })
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.calculator',
      windowId: calcId,
    })
    expect(useWindowStore.getState().windows).toHaveLength(2)
    expect(screen.getByTestId('mobile-app-host')).toHaveAttribute('data-window-id', calcId)
    expect(notesId).toBeDefined()
  })

  it('closeApp（后台记录）→ 记录移除 + 对应窗口关闭（app.stopped 派生正确），宿主视图不动', () => {
    render(<MobileAppHost />)
    const calcId = openApp('com.ageha.calculator')
    const notesId = openApp('com.ageha.notes')

    act(() => {
      useMobileNavStore.getState().closeApp(calcId)
    })
    expect(useMobileNavStore.getState().apps.map((app) => app.windowId)).toEqual([notesId])
    expect(useWindowStore.getState().windows.map((win) => win.id)).toEqual([notesId])
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: notesId,
    })
  })

  it('closeApp（宿主记录）→ 窗口关闭 + nav 回 home + 退场帧', async () => {
    render(<MobileAppHost />)
    openApp('com.ageha.notes')

    act(() => {
      useMobileNavStore.getState().closeApp(
        useMobileNavStore.getState().apps[0]?.windowId ?? '',
      )
    })
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(useWindowStore.getState().windows).toHaveLength(0)
    await waitFor(
      () => expect(screen.queryByTestId('mobile-app-host')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
  })

  it('closeAllApps → 全部窗口关闭 + 回 home', () => {
    render(<MobileAppHost />)
    openApp('com.ageha.calculator')
    openApp('com.ageha.notes')
    expect(useWindowStore.getState().windows).toHaveLength(2)

    act(() => {
      useMobileNavStore.getState().closeAllApps()
    })
    expect(useMobileNavStore.getState().apps).toEqual([])
    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('后台窗口被外部关闭 → 哨兵剪记录，宿主视图不动', () => {
    render(<MobileAppHost />)
    const calcId = openApp('com.ageha.calculator')
    const notesId = openApp('com.ageha.notes')

    act(() => {
      useWindowStore.getState().close(calcId)
    })
    expect(useMobileNavStore.getState().apps.map((app) => app.windowId)).toEqual([notesId])
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: notesId,
    })
  })

  it('popstate 层级：覆盖层打开时返回键先关覆盖层（应用栈位不被花掉）', () => {
    render(<MobileAppHost />)
    openApp('com.ageha.calculator')
    const lengthAfterApp = window.history.length

    act(() => {
      useMobileRecentsStore.getState().openRecents()
    })
    // 覆盖层压自己的栈位，应用栈位原样。
    expect(window.history.length).toBe(lengthAfterApp + 1)
    expect(window.history.state?.agehaMobileRecents).toBe(true)

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(useMobileRecentsStore.getState().open).toBe(false)
    // 应用视图原样（backToHome 没被这个返回键触发）。
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.calculator',
      windowId: useWindowStore.getState().windows[0]?.id,
    })
  })

  it('popstate（home 档覆盖层打开）：先关覆盖层，nav 保持 home', () => {
    render(<MobileAppHost />)
    openApp('com.ageha.calculator')
    act(() => {
      useMobileNavStore.getState().backToHome()
    })

    act(() => {
      useMobileRecentsStore.getState().openRecents()
    })
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(useMobileRecentsStore.getState().open).toBe(false)
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('覆盖层关闭后的下一次 popstate 仍退出应用视图（应用栈位完好）', () => {
    render(<MobileAppHost />)
    openApp('com.ageha.calculator')
    act(() => {
      useMobileRecentsStore.getState().openRecents()
    })
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate')) // 消化覆盖层栈位
    })
    expect(useMobileRecentsStore.getState().open).toBe(false)

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate')) // 消化应用栈位
    })
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })
})
