import { fireEvent, render, screen, act } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { resetAppStore } from '@/store/app-store'
import { resetLauncherStore, useLauncherStore } from '@/store/launcher-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetWorkspaceStore, useWorkspaceStore } from '@/store/workspace-store'

import { Sidebar } from './Sidebar'
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

  it('starts collapsed: no data-expanded, width token class, panel inert + aria-hidden', () => {
    render(<SidebarHarness />)

    const nav = screen.getByTestId('sidebar')
    expect(nav.getAttribute('data-expanded')).toBeNull()
    expect(nav.className).toContain('w-[calc(var(--ag-rail-left-width)-0.5rem)]')
    // 宽度过渡走 --ag-motion-base（既有 motion Token，不另起系统）。
    expect(nav.className).toContain('transition-[width]')
    expect(nav.className).toContain('[transition-duration:var(--ag-motion-base)]')

    const panelBody = screen.getByTestId('workspace-panel')
    expect(panelBody.hasAttribute('inert')).toBe(true)
    expect(panelBody.getAttribute('aria-hidden')).toBe('true')
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

    expect(nav.getAttribute('data-expanded')).toBe('true')
    expect(brand.getAttribute('aria-expanded')).toBe('true')
    expect(nav.className).toContain('w-[calc(var(--ag-rail-left-expanded-width)-0.5rem)]')
    expect(screen.getByTestId('workspace-panel').hasAttribute('inert')).toBe(false)

    // pin 态下鼠标离开不收起。
    fireEvent.mouseEnter(nav)
    fireEvent.mouseLeave(nav)
    act(() => vi.advanceTimersByTime(400))
    expect(nav.getAttribute('data-expanded')).toBe('true')

    fireEvent.click(brand)
    expect(nav.getAttribute('data-expanded')).toBeNull()
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

    // 动作条目（设置）：启动 + 面板收起——窗口左缘控件不被 324px 面板盖住。
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

  it('keeps rail tooltips for the collapsed state (os-tooltip carriers, aria-hidden)', () => {
    render(<SidebarHarness />)

    const item = screen.getByTestId('sidebar-files')
    expect(item.getAttribute('aria-label')).toBe('文件管理')
    const tooltip = item.querySelector('.os-tooltip')
    expect(tooltip).not.toBeNull()
    expect(tooltip?.textContent).toBe('文件管理')
    expect(tooltip?.getAttribute('aria-hidden')).toBe('true')
  })

  it('rail items stay light translucent capsules — no solid primary blocks', () => {
    render(<SidebarHarness />)

    for (const testid of ['sidebar-desktop', 'sidebar-launcher', 'sidebar-files', 'sidebar-notes', 'sidebar-terminal', 'sidebar-settings', 'sidebar-notifications']) {
      const item = screen.getByTestId(testid)
      for (const cls of ['h-11', 'w-11', 'rounded-full', 'hover:bg-surface-raised', 'active:bg-surface-elevated', 'data-[active]:bg-surface-raised']) {
        expect(item.classList.contains(cls), `${testid} missing ${cls}`).toBe(true)
      }
      // 禁实心蓝色块（用户一票否决）：条目永不挂 bg-primary。
      expect(item.classList.contains('bg-primary'), `${testid} has bg-primary`).toBe(false)
    }
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
})
