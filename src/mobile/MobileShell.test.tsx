import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MobileShell } from './MobileShell'
import { resetAppStore } from '@/store/app-store'
import { resetMobileLauncherStore, useMobileLauncherStore } from '@/store/mobile-launcher-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetMobileRecentsStore, useMobileRecentsStore } from '@/store/mobile-recents-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetWindowStore } from '@/store/window-store'

/**
 * M0-4 Safe Area + M1-1 + M1-2：移动 Shell 三段骨架的 DOM 契约。safe-area
 * 的几何语义（env(safe-area-inset-*) 与 max() 保底高度）jsdom 算不了 env，
 * 几何探针归 E2E（e2e/mobile-shell.spec.ts）；这里钉住结构与类名接线，
 * 防止后续切片静默拆掉占位带/滚动容器。M1-1 起状态栏填充真实状态条（不再
 * aria-hidden 空占位）、内容区挂 Home 视图；M1-2 起根元素反射
 * mobile-nav-store 当前位置（data-nav-view / data-nav-app-id，E2E 断言口）。
 */
describe('MobileShell', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetSessionStore()
    resetMobileNavStore()
    resetMobileLauncherStore()
    resetMobileRecentsStore()
    resetWindowStore()
  })

  it('renders the three-slot skeleton with safe-area band classes (M0-4)', () => {
    const { container } = render(<MobileShell />)

    const shell = screen.getByTestId('mobile-shell')
    expect(shell).toHaveAttribute('data-shell', 'mobile')
    expect(shell).toHaveClass('mobile-shell')

    const statusbar = screen.getByTestId('mobile-statusbar-slot')
    const content = screen.getByTestId('mobile-content-slot')
    const dock = screen.getByTestId('mobile-dock-slot')

    // 两条占位带挂 max() 高度类（index.css 移动段），收缩禁止交给 shrink-0。
    expect(statusbar).toHaveClass('mobile-statusbar-slot')
    expect(statusbar).toHaveClass('shrink-0')
    expect(dock).toHaveClass('mobile-dock-slot')
    expect(dock).toHaveClass('shrink-0')

    // DOM 序 = 视觉序（DESIGN.md §0.6）：状态栏 → 内容 → Dock。
    expect(
      statusbar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      content.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // M1-1：状态栏填充真实状态条（能力不可用的 jsdom 里时钟恒在场；
    // 会话缺席时用户名也隐藏——「不可用即隐藏」口径对用户名同样成立）。
    expect(screen.getByTestId('mobile-statusbar')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-statusbar-clock')).toBeInTheDocument()

    // Dock 安全区预留带仍是纯占位（辅助技术不可见）；Dock 本体（M1-5）
    // 在带上方，带只承担 safe-area bottom 高度（见下方 M1-5 用例）。
    expect(dock).toHaveAttribute('aria-hidden', 'true')
    expect(dock).toBeEmptyDOMElement()

    // 壁纸层全幅挂在 shell 根（padding 盒外），frame 只承担左右 padding。
    expect(screen.getByTestId('wallpaper-layer')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-shell-frame')).toHaveClass('mobile-shell-frame')
    expect(container.querySelector('.mobile-shell-frame')?.parentElement).toBe(shell)
  })

  it('constrains content within the safe area and reserves the scroll container (M0-4/M1-1)', () => {
    seedSessionForTests({
      id: 'u1',
      username: 'e2emobile',
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    })
    render(<MobileShell />)

    const content = screen.getByTestId('mobile-content-slot')
    const scroll = screen.getByTestId('mobile-content-scroll')

    // 滚动容器是内容区的直接滚动面（Home/应用视图挂这里）。
    expect(content).toContainElement(scroll)
    expect(scroll).toHaveClass('mobile-content-scroll')

    // Home 视图活在滚动容器内：品牌字（M0 标记位随迁）+ 品牌头 + 时段问候。
    expect(scroll).toContainElement(screen.getByTestId('mobile-home'))
    expect(screen.getByTestId('mobile-shell-brand')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-home-greeting')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'AgehaOS 移动版',
    )
  })

  it('根元素反射 mobile-nav-store 当前位置：home 默认 / openApp 后 app + appId（M1-2）', () => {
    // M1-6 起 openApp 在 AppHost 里升级为真实启动：manifest 缺席会被判
    // 拒绝并弹回 home——先注册内建（与 boot 同口径）再推进导航。
    localStorage.clear()
    resetAppStore()
    resetWindowStore()
    const { rerender } = render(<MobileShell />)

    // 默认 home：只反射 view，无 appId 标记。
    const shell = screen.getByTestId('mobile-shell')
    expect(shell).toHaveAttribute('data-nav-view', 'home')
    expect(shell).not.toHaveAttribute('data-nav-app-id')

    // 导航推进（TodayWorldCard「查看世界」同一路径）：反射跟随到 app 档。
    useMobileNavStore.getState().openApp('com.ageha.dynamic.panel')
    rerender(<MobileShell />)
    expect(shell).toHaveAttribute('data-nav-view', 'app')
    expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.dynamic.panel')
  })

  // M1-5 Dock：坐在 Dock 安全区预留带上方（HANDOFF §4.0-6），DOM 序 =
  // 内容区 → Dock → 预留带；带保持纯占位空带（Home indicator 呼吸位）。
  it('Dock 挂在内容区与安全区预留带之间：固定 5 位齐、带仍纯占位（M1-5）', () => {
    localStorage.clear()
    resetAppStore()
    render(<MobileShell />)

    const dock = screen.getByTestId('mobile-dock')
    const band = screen.getByTestId('mobile-dock-slot')

    // Dock 本体在预留带上方（「填充 mobile-dock-slot 上方」契约）。
    expect(dock.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 预留带契约不变：纯占位空带、辅助技术不可见（M0-4）。
    expect(band).toHaveAttribute('aria-hidden', 'true')
    expect(band).toBeEmptyDOMElement()

    // 固定 5 位齐：Home 位 + Files/Notes/今日世界/Settings 四应用位。
    expect(screen.getByTestId('mobile-dock-home')).toBeInTheDocument()
    expect(screen.getAllByTestId('mobile-dock-app')).toHaveLength(4)
  })

  // M3-1 上滑唤起启动器：Dock 区包裹层（mobile-dock-zone）把 Dock 本体与
  // safe-area 预留带收进同一指针采集面——手势挂载点的结构契约（几何与真实
  // 触控归 E2E mobile-swipe-up-launcher.spec.ts）。
  it('Dock 区包裹层收拢 Dock 本体与预留带：上滑手势触发区的结构契约（M3-1）', () => {
    localStorage.clear()
    resetAppStore()
    render(<MobileShell />)

    const zone = screen.getByTestId('mobile-dock-zone')
    const dock = screen.getByTestId('mobile-dock')
    const band = screen.getByTestId('mobile-dock-slot')

    // 包裹层只承担指针采集（无样式无角色，shrink-0 保三段骨架高度契约）。
    expect(zone).toHaveClass('shrink-0')
    // Dock 本体与预留带都是包裹层子元素（挂载面 = Dock 底缘 + 预留带）。
    expect(zone).toContainElement(dock)
    expect(zone).toContainElement(band)
    // 预留带契约不变：纯占位空带、辅助技术不可见（M0-4）。
    expect(band).toHaveAttribute('aria-hidden', 'true')
    expect(band).toBeEmptyDOMElement()
  })

  // M3-1 接线：底缘带上滑（touch 指针）→ mobile-launcher-store.open →
  // 抽屉在场。jsdom rect 恒 0，hook 视口回退 window 尺寸（1024×768），
  // 底缘带 = y ≥ 696；rAF/时钟用 fake timers 驱动。
  it('Dock 区上滑 → 打开启动器（手势确认写 mobile-launcher-store）（M3-1）', () => {
    localStorage.clear()
    resetAppStore()
    render(<MobileShell />)

    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'],
    })
    expect(screen.queryByTestId('mobile-launcher')).toBeNull()

    const zone = screen.getByTestId('mobile-dock-zone')
    const swipe = (type: string, y: number): void => {
      act(() => {
        zone.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch',
            clientX: 512,
            clientY: y,
          }),
        )
      })
    }

    // down(760) → move(660) + 推一帧 → move(600) + 推一帧 → up：距离 160 >
    // 0.15×768 = 115.2，距离档确认。
    swipe('pointerdown', 760)
    swipe('pointermove', 660)
    act(() => {
      vi.advanceTimersByTime(16)
    })
    swipe('pointermove', 600)
    act(() => {
      vi.advanceTimersByTime(16)
    })
    swipe('pointerup', 600)

    expect(useMobileLauncherStore.getState().open).toBe(true)
    expect(screen.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('mobile-launcher-sheet')).toHaveAttribute('role', 'dialog')
  })

  // M1-6 AppHost：内容区按 nav 分支——home 挂 MobileHome；view='app' 换成
  // MobileAppHost 全屏面板（Home 卸载），data-window-count 反射窗口 store
  // 与视图同步（E2E 断言口，与 data-nav-* 同一先例）。
  it('内容区分支：home=MobileHome / app=MobileAppHost 面板，窗口计数反射同步（M1-6）', () => {
    localStorage.clear()
    resetAppStore()
    resetWindowStore()
    render(<MobileShell />)

    // home 默认：Home 视图在场、宿主缺席、窗口计数 0。
    const shell = screen.getByTestId('mobile-shell')
    expect(screen.getByTestId('mobile-home')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-app-host')).not.toBeInTheDocument()
    expect(shell).toHaveAttribute('data-window-count', '0')

    // openApp → 真实启动（M1-6 升级）：面板盖满内容滚动容器，Home 卸载，
    // 窗口计数 1，面板携带非空 data-window-id。
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.calculator')
    })
    expect(screen.queryByTestId('mobile-home')).not.toBeInTheDocument()
    const host = screen.getByTestId('mobile-app-host')
    expect(host).toHaveAttribute('data-app-id', 'com.ageha.calculator')
    expect(host.getAttribute('data-window-id')).not.toBe('')
    expect(shell).toHaveAttribute('data-window-count', '1')
  })

  // M3-2 最近任务覆盖层：Bottom Sheet 挂 Shell 根（Home 与应用视图之上），
  // 开合归 mobile-recents-store，关闭回焦 Dock Home 位（回焦接线在本组件，
  // 经 testid 定位触发器）。
  it('M3-2 最近任务覆盖层挂 Shell 根：开合写 store，关闭回焦 Dock Home 位', () => {
    localStorage.clear()
    resetAppStore()
    resetWindowStore()
    render(<MobileShell />)

    expect(screen.queryByTestId('mobile-recents')).not.toBeInTheDocument()

    // 造一条已开记录（真实启动归 AppHost 集成测试/E2E）再开门。
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.files')
      useMobileNavStore.getState().setAppWindow('win-files')
      useMobileRecentsStore.getState().openRecents()
    })
    const layer = screen.getByTestId('mobile-recents')
    expect(layer).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('mobile-recents-sheet')).toHaveAttribute('role', 'dialog')
    // 卡片带 data-window-id（E2E 断言口）。
    expect(screen.getByTestId('mobile-recents-card')).toHaveAttribute('data-window-id', 'win-files')

    // 关闭（backdrop 路径统一经 onClose 回焦接线）→ store 关 + Home 位回焦。
    fireEvent.click(screen.getByTestId('mobile-recents-backdrop'))
    expect(useMobileRecentsStore.getState().open).toBe(false)
    expect(document.activeElement).toBe(screen.getByTestId('mobile-dock-home'))
  })
})
