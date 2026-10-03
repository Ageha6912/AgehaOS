import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isRemoteAuthActive } from '@/core/auth'
import { resetAppStore } from '@/store/app-store'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { setSyncEnabled } from '@/services/settings-sync'

import { systemDynamicDesktop } from '@/services/dynamic-desktop'

import { MenuBar } from './MenuBar'

vi.mock('@/services/dynamic-desktop', () => ({
  systemDynamicDesktop: { refresh: vi.fn(async () => undefined) },
}))
// Cloud 要素（§1②）三态断言需要可控的远程模式探测；其余 auth 导出保持原样。
vi.mock('@/core/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isRemoteAuthActive: vi.fn(),
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  localStorage.clear()
  resetWindowStore()
  resetAppStore()
  resetSettingsStore()
  resetSessionStore()
  resetSearchStore()
  seedSessionForTests({
    id: 'u1',
    username: 'alice',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  })
  vi.mocked(systemDynamicDesktop.refresh).mockClear()
  // 默认本地模式（undefined = falsy），远程态测试内显式覆盖。
  vi.mocked(isRemoteAuthActive).mockReset()
})

describe('MenuBar', () => {
  it('renders brand, four menus, and the migrated system status (cloud/bell/user/clock)', () => {
    render(<MenuBar />)

    expect(screen.getByText('AgehaOS')).toBeInTheDocument()
    // Shell 2.0 四菜单（§1① 裁决）：编辑触发器退役，能力并入文件菜单。
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.getByRole('button', { name: '视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '窗口' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '帮助' })).toBeInTheDocument()
    // 右簇五要素（§1②）：Cloud 深链 + 系统状态自任务栏迁移（Q3 裁决）。
    expect(screen.getByRole('button', { name: /云同步/ })).toBeInTheDocument()
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /alice/ })).toBeInTheDocument()
    expect(screen.getByTestId('menu-bar-clock').textContent).toContain('10:30')
  })

  it('file menu issues the migrated edit commands (undo/redo/cut/copy/paste/selectAll)', () => {
    render(<MenuBar />)

    // jsdom 未定义 execCommand——直接桩一个可断言的实现。
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    // §1①：编辑 6 项挂文件菜单第二分组（搜索… 之后，分隔线开界）。
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '撤销' }))
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '全选' }))
    expect(execCommand).toHaveBeenCalledWith('undo', false, undefined)
    expect(execCommand).toHaveBeenCalledWith('selectAll', false, undefined)
    delete (document as unknown as Record<string, unknown>).execCommand
  })

  it('file menu opens the file manager and the search palette', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件管理器' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.files')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '搜索…' }))
    expect(useSearchStore.getState().open).toBe(true)
  })

  it('view menu renews the wallpaper and switches themes with a checked mark', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '视图' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '更换壁纸' }))
    expect(systemDynamicDesktop.refresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '视图' }))
    const lightItem = screen.getByRole('menuitem', { name: '浅色' })
    // §32 起浅色为出厂默认（参考图明亮基线）——浅色项带勾，深色不带。
    expect(lightItem.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: '深色' }).querySelector('svg')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '深色' }))
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('window menu lists open windows, focuses on click, and minimizes all', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    expect(screen.getByRole('menuitem', { name: '文件' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: '记事' }).querySelector('svg')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '记事' }))
    // focus() 会把聚焦窗口移到数组末尾（z 序驱动）——按 appId 断言。
    const focused = useWindowStore
      .getState()
      .windows.find((win) => win.appId === 'com.ageha.notes')
    expect(focused?.focused).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '最小化全部窗口' }))
    const windows = useWindowStore.getState().windows
    expect(windows.every((win) => win.state === 'minimized')).toBe(true)
  })

  it('disables window actions when no windows are open', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    expect(screen.getByRole('menuitem', { name: '最小化全部窗口' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: '关闭全部窗口' })).toBeDisabled()
    expect(screen.queryByRole('menuitem', { name: '记事' })).not.toBeInTheDocument()
  })

  it('mounts the today-world signal note when the world of today is in', () => {
    act(() => {
      resetEclosionStore()
      seedEclosionForTests('u1', true)
      // beforeEach 的 fake 时间钉在 2026-09-21（UTC 日界）。
      useEclosionStore.getState().applyWorld({
        worldDate: '2026-09-21',
        headline: '本地智能体与边缘推理的清晨',
        paletteId: 'nebula-violet',
        accentHue: 212,
        degraded: false,
        signalCount: 3,
        signals: {
          titles: ['信号甲', '信号乙', '信号丙'],
          sourceName: 'GitHub Trending',
          sourceUrl: 'https://example.invalid/feed',
        },
        apps: [],
      })
    })
    render(<MenuBar />)

    expect(screen.getByTestId('menubar-world-signals')).toHaveTextContent(
      '今日桌面由 3 条趋势信号生成',
    )
    // 点击展开来源列表（§6.3 透明性）。
    fireEvent.click(screen.getByTestId('menubar-world-signals'))
    expect(screen.getByTestId('menubar-world-signals-panel')).toBeInTheDocument()
    expect(screen.getAllByTestId('menubar-world-signal')).toHaveLength(3)
    resetEclosionStore()
  })

  it('help menu opens settings', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '帮助' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '关于 AgehaOS' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.settings')
  })

  it('help menu opens a keyboard shortcuts panel and restores focus on close (UI review P2-8)', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '帮助' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '键盘快捷键' }))

    const dialog = screen.getByRole('dialog', { name: '键盘快捷键' })
    // 传送到 body：菜单栏 backdrop-filter 不再是遮罩的包含块。
    expect(screen.getByTestId('menu-bar').contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('Ctrl+K')
    expect(dialog.textContent).toContain('Alt+W')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '知道了' }))

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '帮助' }))
  })

  it('shows platform shortcut hints on menu items without polluting their names', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    const search = screen.getByRole('menuitem', { name: '搜索…' })
    expect(search.textContent).toContain('Ctrl+K')
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K')
    expect(screen.getByRole('menuitem', { name: '重做' }).textContent).toContain('Ctrl+Y')

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    const next = screen.getByRole('menuitem', { name: '切换到下一个窗口' })
    expect(next).toHaveAttribute('aria-keyshortcuts', 'Alt+W')
    fireEvent.click(next)
    expect(useWindowStore.getState().windows.find((win) => win.focused)?.appId).toBe('com.ageha.notes')
  })

  it('shows only real status indicators (no decorative Wi-Fi/Bluetooth)', () => {
    render(<MenuBar />)

    const header = screen.getByTestId('menu-bar')
    expect(header.querySelector('[title*="Wi-Fi"]')).toBeNull()
    expect(header.querySelector('[title*="蓝牙"]')).toBeNull()
    expect(screen.getByRole('navigation', { name: '菜单' })).toBeInTheDocument()
  })

  it('closes on Escape and on outside pointerdown, and hover-switches between menus', () => {
    render(<MenuBar />)

    const file = screen.getByRole('button', { name: '文件' })
    fireEvent.click(file)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // 悬停切换（有菜单打开时滑过即切换）。
    fireEvent.pointerEnter(screen.getByRole('button', { name: '视图' }))
    expect(screen.getByRole('menuitem', { name: '更换壁纸' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(file)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('supports arrow-key traversal across triggers, items and menus (§19)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<MenuBar />)

    // 触发器左右环游（Shell 2.0 四菜单：文件 → 视图，编辑已并入文件）。
    const file = screen.getByRole('button', { name: '文件' })
    const view = screen.getByRole('button', { name: '视图' })
    file.focus()
    fireEvent.keyDown(file, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(view)
    fireEvent.keyDown(view, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(file)

    // ArrowDown 开菜单并聚焦首项；菜单内上下循环（始终驱动当前焦点元素）。
    const active = () => document.activeElement as HTMLElement
    fireEvent.keyDown(file, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开文件管理器' }))
    fireEvent.keyDown(active(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '搜索…' }))
    // 文件菜单第二分组 = 迁移后的编辑项（分隔线跳过，menuitem 连续环游）。
    fireEvent.keyDown(active(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '撤销' }))
    fireEvent.keyDown(active(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '搜索…' }))

    // 菜单内右键头 → 切到下一个菜单（视图，已打开）。
    fireEvent.keyDown(active(), { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: '视图' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: '更换壁纸' })).toBeInTheDocument()

    // Esc 回焦触发器并关闭。
    fireEvent.keyDown(active(), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '视图' }))
  })

  it('exposes aria-expanded on menu triggers', () => {
    render(<MenuBar />)

    const view = screen.getByRole('button', { name: '视图' })
    expect(view).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(view)
    expect(view).toHaveAttribute('aria-expanded', 'true')
  })

  it('wears the shell 2.0 menubar material and 13px menu type (§4.2①)', () => {
    render(<MenuBar />)

    // 材质表①：desktop-chrome 白字域 + menubar-glass 白10% 底 + surface-glass
    // 基础 + glass-hint（12px blur，地基切片材质块）。
    const header = screen.getByTestId('menu-bar')
    for (const cls of ['desktop-chrome', 'menubar-glass', 'surface-glass', 'glass-hint']) {
      expect(header.classList.contains(cls), cls).toBe(true)
    }
    // 菜单文字 13px（触发器 + 菜单项；裁决 J：时钟/电池数据读出豁免）。
    expect(screen.getByRole('button', { name: '文件' }).classList.contains('text-[13px]')).toBe(true)
    expect(screen.getByRole('button', { name: '视图' }).classList.contains('text-[13px]')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.getByRole('menuitem', { name: '打开文件管理器' }).classList.contains('text-[13px]')).toBe(true)
    expect(screen.getByRole('menuitem', { name: '撤销' }).classList.contains('text-[13px]')).toBe(true)
  })

  it('orders the status cluster system→cloud→bell→user→time with the clock rightmost (§1②)', () => {
    render(<MenuBar />)

    // 时钟移到最右（macOS 惯例）：时钟跟随用户元素（防顺序回退的位掩码断言）。
    const clock = screen.getByTestId('menu-bar-clock')
    const userBtn = screen.getByRole('button', { name: /alice/ })
    expect(userBtn.compareDocumentPosition(clock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 时钟保持等宽数据层字号（裁决 J 豁免 13px 口径）。
    expect(clock.classList.contains('text-xs')).toBe(true)
  })

  it('cloud indicator mirrors sync state and deep-links settings to the account section (§1②)', () => {
    render(<MenuBar />)

    // 本地模式：text-disabled + 组合 title（复用 sidebar.* 词条，零新增键）。
    const cloud = screen.getByRole('button', { name: '云同步 · 远程模式登录后可用' })
    expect(cloud.classList.contains('text-disabled')).toBe(true)
    // 点击 = 深链设置账户分区 + 启动设置（与左栏云同步项同款路径）。
    fireEvent.click(cloud)
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.settings')

    // 远程开启 + 同步开：text-primary（SYNC_TOGGLE_EVENT 驱动的重渲染包 act，
    // 坑 12：act 外 setState 不触发 RTL 重渲染）。
    act(() => {
      vi.mocked(isRemoteAuthActive).mockReturnValue(true)
      setSyncEnabled(true)
    })
    expect(screen.getByRole('button', { name: '云同步 · 云同步已开启' }).classList.contains('text-primary')).toBe(true)
  })
})
