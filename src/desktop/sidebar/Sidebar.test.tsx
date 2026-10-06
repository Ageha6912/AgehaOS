import { fireEvent, render, screen, act } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetLauncherStore, useLauncherStore } from '@/store/launcher-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetWorkspaceStore, useWorkspaceStore } from '@/store/workspace-store'

import { Sidebar } from './Sidebar'
import { utcDayKey } from '@/core/eclosion/world'
import {
  consumeLauncherCategory,
  resetLauncherIntent,
} from '@/desktop/taskbar/launcher-intent'
import { useWorkspacePanel } from '@/desktop/workspace/use-workspace-panel'

/**
 * Sidebar 单测无 Desktop 外壳——用最小 harness 复刻组容器接线
 * （边界 ref + useWorkspacePanel 事件），与 Desktop.tsx 的真实结构一致。
 */
function SidebarHarness() {
  const boundaryRef = useRef<HTMLDivElement | null>(null)
  const panel = useWorkspacePanel(boundaryRef)
  return (
    <div
      ref={boundaryRef}
      data-expanded={panel.expanded || undefined}
      onMouseEnter={panel.onMouseEnter}
      onMouseLeave={panel.onMouseLeave}
      onFocusCapture={panel.onFocusCapture}
      onBlurCapture={panel.onBlurCapture}
    >
      <Sidebar panel={panel} />
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  resetWindowStore()
  resetAppStore()
  resetNotificationStore()
  resetLauncherStore()
  resetUsageStore()
  resetWorkspaceStore()
  resetSessionStore()
  resetEclosionStore()
  resetLauncherIntent()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Sidebar（Workspace Rail + Workspace Panel）', () => {
  it('renders the rail entries in order: brand + desktop/launcher/files/notes/terminal/settings/notifications', () => {
    render(<SidebarHarness />)

    // 品牌钮（pin 开关）+ 七个动作条目按裁决顺序排列。
    for (const name of ['展开工作空间面板', '桌面', '启动器', '文件管理', '记事', '终端', '设置', '通知中心']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // 商店/云同步/用户中心退出版面（入口仍在：Dock 常驻瓷贴/顶栏 Cloud/顶栏用户菜单）。
    for (const name of ['应用商店', '云同步', '用户中心']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    const order = ['brand', 'desktop', 'launcher', 'files', 'notes', 'terminal', 'settings', 'notifications'].map(
      (id) => screen.getByTestId(`sidebar-${id}`),
    )
    for (let index = 1; index < order.length; index += 1) {
      const relation = order[index - 1]!.compareDocumentPosition(order[index]!)
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('starts collapsed: rail island narrow capsule, no data-expanded, panel island unmounted', () => {
    render(<SidebarHarness />)

    const rail = screen.getByTestId('sidebar')
    expect(rail.getAttribute('data-expanded')).toBeNull()
    // 窄轨岛两态恒宽（72px = token − 0.5rem）；宽度过渡移到面板岛。
    expect(rail.className).toContain('w-[calc(var(--ag-rail-left-width)-0.5rem)]')
    expect(rail.className).toContain('pointer-events-auto')
    expect(screen.queryByTestId('workspace-panel-island')).toBeNull()
  })

  it('renders two separate glass islands once expanded（§34 双岛：rail 与 panel 各自成岛）', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const rail = screen.getByTestId('sidebar')
    const island = screen.getByTestId('workspace-panel-island')
    // 玻璃面/圆角/投影在面板岛的内层定宽面上（外层只做宽度裁剪揭示，
    // 收起态零边框投影残影）；窄轨岛自带玻璃面。Shell 3.1 F1 减重分档：
    // 窄轨保持浮岛档（glass-raise + shadow-float）；岛二降档——轻毛玻璃
    // glass-hint（blur 12）+ 发丝边 border-subtle + panel 档投影（本步
    // 减重目标授权的断言更新，非掩盖问题）。
    const surface = screen.getByTestId('workspace-panel-surface')
    for (const el of [rail, surface]) {
      expect(el.className).toContain('surface-glass')
      expect(el.className).toContain('rounded-xl')
    }
    expect(rail.classList.contains('glass-raise')).toBe(true)
    expect(rail.classList.contains('shadow-float')).toBe(true)
    expect(surface.classList.contains('glass-hint')).toBe(true)
    expect(surface.classList.contains('glass-raise')).toBe(false)
    expect(surface.classList.contains('border-border-subtle')).toBe(true)
    expect(surface.classList.contains('border-border')).toBe(false)
    expect(surface.classList.contains('shadow-panel')).toBe(true)
    expect(surface.classList.contains('shadow-float')).toBe(false)
    // 幕帘结构：外层 overflow-hidden（内容列无 os-tooltip；§26 只约束组容器
    // 与窄轨），内层定宽（= 展开档）动画期间内容不回流。
    expect(island.className).toContain('overflow-hidden')
    expect(rail.className).not.toContain('overflow-hidden')
    expect(surface.className).toContain('w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)]')
    // 面板体仍在（id 供品牌钮 aria-controls）。
    expect(screen.getByTestId('workspace-panel')).not.toBeNull()
  })

  it('mounts the panel body lazily on first expansion（净桌面启动不为面板付费）', () => {
    render(<SidebarHarness />)

    // 收起态：内容列不挂载（PRD §29.1 reload 预算）。
    expect(screen.queryByTestId('workspace-panel')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const panelBody = screen.getByTestId('workspace-panel')
    expect(panelBody.hasAttribute('inert')).toBe(false)
    expect(panelBody.getAttribute('aria-hidden')).toBe('false')

    // 首展后常挂：收起只是 inert，不卸载（展开动画与滚动状态不丢）。
    fireEvent.click(screen.getByTestId('sidebar-brand'))
    expect(screen.getByTestId('workspace-panel').hasAttribute('inert')).toBe(true)
  })

  it('the Ageha Mark stays decorative; the brand button carries the accessible name', () => {
    render(<SidebarHarness />)

    const mark = screen.getByTestId('sidebar').querySelector('img')
    expect(mark).not.toBeNull()
    expect(mark?.getAttribute('aria-hidden')).toBe('true')

    const brand = screen.getByTestId('sidebar-brand')
    expect(brand.getAttribute('aria-expanded')).toBe('false')
    expect(brand.getAttribute('aria-controls')).toBe('workspace-panel')
  })

  it('click toggles the pinned expansion（键盘可达：focus + Enter 同路径）', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    const brand = screen.getByTestId('sidebar-brand')
    fireEvent.click(brand)

    // 展开态：面板岛揭示到 304px 档（token 312 − 0.5rem；宽度过渡在岛自身，motion Token）。
    const island = screen.getByTestId('workspace-panel-island')
    expect(nav.getAttribute('data-expanded')).toBe('true')
    expect(brand.getAttribute('aria-expanded')).toBe('true')
    expect(island.className).toContain('w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)]')
    expect(island.className).toContain('transition-[width,opacity]')
    expect(island.className).toContain('[transition-duration:var(--ag-motion-base)]')
    expect(screen.getByTestId('workspace-panel').hasAttribute('inert')).toBe(false)

    // pin 态下鼠标离开不收起。
    fireEvent.mouseEnter(nav)
    fireEvent.mouseLeave(nav)
    act(() => vi.advanceTimersByTime(400))
    expect(nav.getAttribute('data-expanded')).toBe('true')

    fireEvent.click(brand)
    expect(nav.getAttribute('data-expanded')).toBeNull()
    // 收起 = 岛 0 宽 + 不可交互（常挂，不卸载）。
    expect(island.className).toContain('w-0')
    expect(island.className).toContain('pointer-events-none')
  })

  it('hover expands, and mouse leave collapses after the grace period', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    fireEvent.mouseEnter(nav)
    expect(nav.getAttribute('data-expanded')).toBe('true')

    // 240ms 宽限内重进不闪收。
    fireEvent.mouseLeave(nav)
    act(() => vi.advanceTimersByTime(100))
    fireEvent.mouseEnter(nav)
    act(() => vi.advanceTimersByTime(400))
    expect(nav.getAttribute('data-expanded')).toBe('true')

    fireEvent.mouseLeave(nav)
    act(() => vi.advanceTimersByTime(300))
    expect(nav.getAttribute('data-expanded')).toBeNull()
  })

  it('keyboard focus entering the rail expands it and collapses when focus leaves', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    const brand = screen.getByTestId('sidebar-brand')
    // React onFocus/onBlur 走 focusin/focusout 委托。
    fireEvent.focusIn(brand)
    expect(nav.getAttribute('data-expanded')).toBe('true')

    // 焦点移出边界（relatedTarget 为空）→ 收起。
    fireEvent.focusOut(brand)
    expect(nav.getAttribute('data-expanded')).toBeNull()
  })

  it('pointer-initiated focus does not hold the panel open（鼠标点击后可正常收起）', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    const files = screen.getByTestId('sidebar-files')
    // 指针按下 → 点击条目 → 焦点到达：来源为指针，不计入聚焦展开。
    fireEvent.pointerDown(files)
    fireEvent.click(files)
    fireEvent.focusIn(files)
    expect(nav.getAttribute('data-expanded')).toBeNull()

    // 键盘事件解除抑制后，聚焦展开语义恢复（Tab 进入即展开）。
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.focusIn(files)
    expect(nav.getAttribute('data-expanded')).toBe('true')
  })

  it('Escape and outside pointerdown collapse the pinned panel', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    fireEvent.click(screen.getByTestId('sidebar-brand'))
    expect(nav.getAttribute('data-expanded')).toBe('true')

    // 面板外按下 → 收起（§24 精神的就地实现）。
    fireEvent.pointerDown(document.body)
    expect(nav.getAttribute('data-expanded')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(nav.getAttribute('data-expanded')).toBeNull()
  })

  it('Escape collapses the hover-expanded panel too（收起契约不限 pin）', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    fireEvent.mouseEnter(nav)
    expect(nav.getAttribute('data-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(nav.getAttribute('data-expanded')).toBeNull()
  })

  it('rail action clicks collapse the panel (打开的窗口立即脱离面板遮盖)', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    fireEvent.click(screen.getByTestId('sidebar-brand'))
    expect(nav.getAttribute('data-expanded')).toBe('true')

    // 动作条目（设置）：启动 + 面板收起——窗口左缘控件不被 312px 面板盖住。
    fireEvent.click(screen.getByTestId('sidebar-settings'))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.settings')
    expect(nav.getAttribute('data-expanded')).toBeNull()
  })

  it('opening the shared launcher or notification panel collapses the rail panel（弹层互斥）', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    fireEvent.click(screen.getByTestId('sidebar-brand'))
    expect(nav.getAttribute('data-expanded')).toBe('true')

    act(() => {
      useLauncherStore.getState().toggleLauncher()
    })
    expect(nav.getAttribute('data-expanded')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    act(() => {
      useNotificationStore.getState().togglePanel()
    })
    expect(nav.getAttribute('data-expanded')).toBeNull()
  })

  it('the workspace selector persists the choice and reflects aria-pressed', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    fireEvent.click(screen.getByTestId('workspace-option-study'))

    expect(useWorkspaceStore.getState().workspace).toBe('study')
    expect(JSON.parse(localStorage.getItem('agehaos.workspace.v1')!)).toBe('study')
    expect(screen.getByTestId('workspace-option-study').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('workspace-option-personal').getAttribute('aria-pressed')).toBe('false')
    // 选择后面板保持展开（不闪收）。
    expect(screen.getByTestId('sidebar').getAttribute('data-expanded')).toBe('true')
  })

  it('recent rows come from the usage store, ordered by workspace affinity, and launch on click', () => {
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    useUsageStore.getState().recordRecentApp('com.ageha.terminal')
    useWorkspaceStore.getState().setWorkspace('dev')
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const rows = screen.getAllByTestId('workspace-recent-item')
    expect(rows).toHaveLength(2)
    // dev 空间：终端（dev/tools 亲和）浮到记事之前；同分保持时序。
    expect(rows[0]!.textContent).toContain('终端')
    expect(rows[1]!.textContent).toContain('记事')

    // Shell 3.1 F1 紧凑档：行高 h-8（非 h-9）、AppIcon 20px、行尾无箭头
    // （最近使用 ≤ 工作空间的视觉权重，§11）。
    for (const row of rows) {
      expect(row.classList.contains('h-8')).toBe(true)
      expect(row.classList.contains('h-9')).toBe(false)
      expect(row.querySelector('.ml-auto')).toBeNull()
    }
    const badge = rows[0]!.querySelector('span[aria-hidden="true"]') as HTMLElement | null
    expect(badge?.style.width).toBe('20px')

    fireEvent.click(rows[1]!)
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.notes')
  })

  it('shows an honest empty state when nothing has been used yet', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    expect(screen.queryByTestId('workspace-recent-item')).toBeNull()
    expect(screen.getByTestId('workspace-panel').textContent).toContain('暂无最近使用的应用')
  })

  it('today space renders the real date and the current user in the greeting', () => {
    seedSessionForTests({
      id: 'u1',
      username: 'alice',
      createdAt: '2026-10-04T00:00:00.000Z',
      updatedAt: '2026-10-04T00:00:00.000Z',
    })
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const today = screen.getByTestId('workspace-today')
    // 真实日期（locale 感知，含月/日）。
    expect(today.textContent).toMatch(/\d/)
    // 按当前用户问候。
    expect(today.textContent).toContain('alice')
  })

  it('today space is a wallpaper thumbnail card fed by the real current wallpaper（§34 图卡）', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const today = screen.getByTestId('workspace-today')
    // 缩略图 = 桌面 PhotoSurface 同源的真实壁纸（禁假数据图片）。
    expect(today.style.backgroundImage).toContain('ageha-dreamland')
    expect(today.className).toContain('bg-cover')
  })

  it('panel sections collapse and restore their rows（§34 可折叠分组）', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const header = screen.getByTestId('panel-section-workspaces')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('workspace-option-personal')).toBeInTheDocument()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('workspace-option-personal')).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('workspace-option-personal')).toBeInTheDocument()
  })

  it('workspace selector rows carry the gradient active capsule and row chevrons（§34 行样式）', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))
    const active = screen.getByTestId('workspace-option-personal')
    // 选中 = 同族明暗渐变胶囊（--ag-capsule-active）；禁实心 bg-primary。
    expect(active.className).toContain('[background:var(--ag-capsule-active)]')
    expect(active.className).not.toContain('bg-primary')
    // Shell 3.1 F1：选中靠主色胶囊本身，去 shadow-sm（无投影无发光）。
    expect(active.className).not.toContain('shadow-sm')
    // 未选中行保留 hover capsule；行尾 ›（aria-hidden 装饰）。
    const idle = screen.getByTestId('workspace-option-study')
    expect(idle.className).toContain('hover:bg-surface-raised')
    expect(idle.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('rail buttons carry aria-label names and no dead tooltip bubbles（终审遗留清理）', () => {
    render(<SidebarHarness />)

    // 可访问名由 aria-label 承载；自绘 os-tooltip 气泡退役——hover/键盘聚焦
    // 任一路都立即展开面板（use-workspace-panel mouseenter 立即展开），气泡
    // 在唯一能点亮的两态下都被 data-expanded 隐藏，属不可达死代码。
    const item = screen.getByTestId('sidebar-files')
    expect(item.getAttribute('aria-label')).toBe('文件管理')
    expect(item.querySelector('.os-tooltip')).toBeNull()
    expect(screen.getByTestId('sidebar-brand').querySelector('.os-tooltip')).toBeNull()
    expect(screen.getByTestId('sidebar-handle').querySelector('.os-tooltip')).toBeNull()
    // 全树无残留：窄轨岛内不存在任何 os-tooltip 载体。
    for (const testid of ['sidebar-desktop', 'sidebar-launcher', 'sidebar-notes', 'sidebar-terminal', 'sidebar-settings', 'sidebar-notifications']) {
      expect(screen.getByTestId(testid).querySelector('.os-tooltip')).toBeNull()
    }
  })

  it('rail items sit on persistent translucent tiles — no solid primary blocks（§34 底座）', () => {
    render(<SidebarHarness />)

    for (const testid of ['sidebar-desktop', 'sidebar-launcher', 'sidebar-files', 'sidebar-notes', 'sidebar-terminal', 'sidebar-settings', 'sidebar-notifications']) {
      const item = screen.getByTestId(testid)
      for (const cls of ['h-11', 'w-11', 'rounded-xl', 'bg-surface-raised', 'hover:bg-surface-elevated', 'active:bg-surface-elevated', 'data-[active]:bg-surface-elevated']) {
        expect(item.classList.contains(cls), `${testid} missing ${cls}`).toBe(true)
      }
      // 禁实心蓝色块（用户一票否决）：条目永不挂 bg-primary。
      expect(item.classList.contains('bg-primary'), `${testid} has bg-primary`).toBe(false)
    }
    // 品牌钮 = 渐变 squircle 徽章（§34 参考图口径，同族明暗非新色相）。
    const brand = screen.getByTestId('sidebar-brand')
    expect(brand.className).toContain('rounded-xl')
    expect(brand.className).toContain('[background:var(--ag-capsule-active)]')
    expect(brand.className).not.toContain('bg-primary')
  })

  it('the rail-bottom handle toggles the panel like the brand button（§34 收起手柄）', () => {
    render(<SidebarHarness />)

    const handle = screen.getByTestId('sidebar-handle')
    // 可访问名独立于品牌钮（读屏可分辨两个入口）。
    expect(handle.getAttribute('aria-label')).toBe('展开面板')
    fireEvent.click(handle)
    expect(screen.getByTestId('sidebar').getAttribute('data-expanded')).toBe('true')
    expect(handle.getAttribute('aria-label')).toBe('收起面板')
    fireEvent.click(handle)
    expect(screen.getByTestId('sidebar').getAttribute('data-expanded')).toBeNull()
  })

  it('toggles the shared launcher panel via the launcher store', () => {
    render(<SidebarHarness />)

    const launcher = screen.getByTestId('sidebar-launcher')
    expect(launcher.getAttribute('aria-expanded')).toBe('false')
    expect(launcher.getAttribute('data-active')).toBeNull()

    fireEvent.click(launcher)
    expect(useLauncherStore.getState().launcherOpen).toBe(true)
    expect(launcher.getAttribute('aria-expanded')).toBe('true')
    expect(launcher.getAttribute('data-active')).toBe('true')

    fireEvent.click(launcher)
    expect(useLauncherStore.getState().launcherOpen).toBe(false)
    expect(launcher.getAttribute('aria-expanded')).toBe('false')
  })

  it('show-desktop minimizes every open window', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-desktop'))

    const windows = useWindowStore.getState().windows
    expect(windows.every((win) => win.state === 'minimized')).toBe(true)
  })

  it('launches apps from the rail', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-files'))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.files')

    fireEvent.click(screen.getByTestId('sidebar-notes'))
    fireEvent.click(screen.getByTestId('sidebar-terminal'))
    fireEvent.click(screen.getByTestId('sidebar-settings'))
    const ids = useWindowStore.getState().windows.map((win) => win.appId)
    expect(ids).toContain('com.ageha.notes')
    expect(ids).toContain('com.ageha.terminal')
    expect(ids).toContain('com.ageha.settings')
  })

  it('toggles the shared notification center panel and shows the unread badge', () => {
    useNotificationStore.getState().push({ appId: 'com.ageha.notes', titleKey: 'boot.progress' })
    render(<SidebarHarness />)

    expect(screen.getByTestId('sidebar-unread').textContent).toBe('1')

    const bell = screen.getByTestId('sidebar-notifications')
    fireEvent.click(bell)
    expect(useNotificationStore.getState().panelOpen).toBe(true)
    expect(bell.getAttribute('aria-expanded')).toBe('true')
    expect(bell.getAttribute('data-active')).toBe('true')

    fireEvent.click(bell)
    expect(useNotificationStore.getState().panelOpen).toBe(false)
    expect(bell.getAttribute('data-active')).toBeNull()
  })

  // ── STEP 3：面板底部「今日世界」品牌入口（复用 eclosion-store 世界摘要）──

  /** 种当日世界摘要（编排器 applyWorld 同形；测试注入不走网络）。 */
  function seedWorld(worldDate: string = utcDayKey()): void {
    seedEclosionForTests('u-sidebar-world', true)
    useEclosionStore.getState().applyWorld({
      worldDate,
      headline: '边缘推理的浪潮',
      paletteId: 'aurora-borealis',
      accentHue: 212,
      degraded: false,
      signalCount: 3,
      signals: {
        titles: ['本地智能体编排框架冲上热榜'],
        sourceName: 'GitHub Trending',
        sourceUrl: 'https://example.com/trending',
      },
      apps: [
        {
          slug: 'edge-oracle',
          name: '边缘神谕',
          hue: 268,
          tagline: '在你的浏览器里预言下一行代码',
          category: 'tools',
          window: { width: 720, height: 480 },
        },
        {
          slug: 'trend-compass',
          name: '趋势罗盘',
          hue: 210,
          tagline: '把六条趋势折叠成一张导航图',
          category: 'tools',
          window: { width: 720, height: 480 },
        },
      ],
    })
  }

  it('today world entry renders the real world summary and jumps to the launcher today category', () => {
    seedWorld()
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))

    // 真实摘要：趋势主题（headline）+ 新应用数 + 今日更新状态。
    const entry = screen.getByTestId('workspace-world-entry')
    expect(entry.textContent).toContain('边缘推理的浪潮')
    expect(entry.textContent).toContain('2 款新应用')
    expect(entry.textContent).toContain('今日已更新')

    // 「查看世界」：打开共享启动器 + 排队「今日」分类定位意图（取走即清）。
    fireEvent.click(entry)
    expect(useLauncherStore.getState().launcherOpen).toBe(true)
    expect(consumeLauncherCategory()).toBe('today')
    expect(consumeLauncherCategory()).toBeNull()
    // 弹层互斥：启动器打开即收起面板（既有契约，不由入口重复收起）。
    expect(screen.getByTestId('sidebar').getAttribute('data-expanded')).toBeNull()
  })

  it('today world entry shows a quiet empty state (no dead jump) when the world has not landed', () => {
    seedEclosionForTests('u-sidebar-world-empty', true)
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))

    expect(screen.getByTestId('workspace-world-empty').textContent).toContain('还未织成')
    // 无数据 → 无「查看世界」死按钮。
    expect(screen.queryByTestId('workspace-world-entry')).toBeNull()
  })

  it('today world entry stays present when eclosion is off and opens Settings（2026-10-05 常驻裁决）', () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))

    // 羽化关：品牌入口常驻（参考图口径），引导卡点击 = 打开设置（真实动作）。
    const entry = screen.getByTestId('workspace-world-entry')
    expect(entry.textContent).toContain('开启羽化')
    fireEvent.click(entry)
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.settings')
    // 关闭态不排「今日」分类意图（那是世界数据域的动作）。
    expect(consumeLauncherCategory()).toBeNull()
    expect(screen.queryByTestId('workspace-world-empty')).toBeNull()
  })

  it('a stale world (session crossed UTC midnight) is labeled honestly as awaiting refresh', () => {
    seedWorld('2026-01-01')
    render(<SidebarHarness />)

    fireEvent.click(screen.getByTestId('sidebar-brand'))

    const entry = screen.getByTestId('workspace-world-entry')
    expect(entry.textContent).toContain('等待换新')
    expect(entry.textContent).not.toContain('今日已更新')
  })
})
