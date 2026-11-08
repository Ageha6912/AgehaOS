import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isRemoteAuthActive } from '@/core/auth'
import { resetAppStore } from '@/store/app-store'
import { resetEclosionStore, seedEclosionForTests, useEclosionStore } from '@/store/eclosion-store'
import { resetMissionControlStore, useMissionControlStore } from '@/store/mission-control-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
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
  resetSpaceStore()
  resetAppStore()
  resetSettingsStore()
  resetSessionStore()
  resetSearchStore()
  // W7：Mission Control 开关逐用例复位（菜单入口 toggle 不跨用例泄漏）。
  resetMissionControlStore()
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

  it('keeps the editable focused when menu commands run (E2 审查)', async () => {
    render(<MenuBar />)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn(async () => '粘贴内容') },
      configurable: true,
    })
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    // 指针按在触发器/菜单项上不得把焦点移走（否则 execCommand 无目标）。
    const trigger = screen.getByRole('button', { name: '文件' })
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    trigger.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    fireEvent.click(trigger)
    const item = screen.getByRole('menuitem', { name: '撤销' })
    const itemDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    item.dispatchEvent(itemDown)
    expect(itemDown.defaultPrevented).toBe(true)
    fireEvent.click(item)
    expect(document.activeElement).toBe(input)
    expect(execCommand).toHaveBeenCalledWith('undo', false, undefined)

    // 粘贴：菜单关闭后异步读剪贴板，仍命中原焦点（不再落回 body）。
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '粘贴' }))
    await vi.waitFor(() =>
      expect(execCommand).toHaveBeenCalledWith('insertText', false, '粘贴内容'),
    )
    expect(document.activeElement).toBe(input)

    input.remove()
    delete (document as unknown as Record<string, unknown>).execCommand
    delete (navigator as unknown as Record<string, unknown>).clipboard
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
    const lightItem = screen.getByRole('menuitemradio', { name: '浅色' })
    // §32 起浅色为出厂默认（参考图明亮基线）——浅色项带勾，深色不带。
    expect(lightItem.querySelector('svg')).not.toBeNull()
    // 勾选语义暴露给读屏（E2 审查：此前只有 aria-hidden 图标）。
    expect(lightItem).toHaveAttribute('aria-checked', 'true')
    const darkItem = screen.getByRole('menuitemradio', { name: '深色' })
    expect(darkItem.querySelector('svg')).toBeNull()
    expect(darkItem).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(darkItem)
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('window menu lists open windows, focuses on click, and minimizes all', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    const focusedItem = screen.getByRole('menuitemradio', { name: '文件' })
    expect(focusedItem.querySelector('svg')).not.toBeNull()
    expect(focusedItem).toHaveAttribute('aria-checked', 'true')
    const otherItem = screen.getByRole('menuitemradio', { name: '记事' })
    expect(otherItem.querySelector('svg')).toBeNull()
    expect(otherItem).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(otherItem)
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

  it('window menu toggles Mission Control（W7，审计 .tmp/spaces-audit.md §10）', () => {
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    const entry = screen.getByRole('menuitem', { name: '任务视图' })
    // F4 无平台写法差异：快捷键提示恒 F4（aria-keyshortcuts 同步）。
    expect(entry).toHaveAttribute('aria-keyshortcuts', 'F4')
    expect(entry.textContent).toContain('F4')

    fireEvent.click(entry)
    expect(useMissionControlStore.getState().open).toBe(true)
    // 菜单随动作收起（act 语义），MC 层保持开启。
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '任务视图' }))
    expect(useMissionControlStore.getState().open).toBe(false)
  })

  it('窗口菜单只列当前 Space，关闭全部只作用于当前 Space（W2，审计 §5 决定 4）', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const other = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件', spaceId: 'space-other' })
    expect(useSpaceStore.getState().activeSpaceId).not.toBe('space-other')
    render(<MenuBar />)

    fireEvent.click(screen.getByRole('button', { name: '窗口' }))
    expect(screen.getByRole('menuitemradio', { name: '记事' })).toBeInTheDocument()
    // 其他 Space 的窗口不进菜单。
    expect(screen.queryByRole('menuitemradio', { name: '文件' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '关闭全部窗口' }))

    const windows = useWindowStore.getState().windows
    // 其他 Space 的窗口存活且不受波及。
    expect(windows.map((win) => win.id)).toEqual([other])
    expect(windows[0]?.state).toBe('normal')
  })

  it('keeps AI world signals out of the menu bar even when the world of today is in（Shell 3.1 F3）', () => {
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

    // Shell 3.1 STEP 3（F3 顶栏信息减法）：AI 产品句迁出顶栏——即使当日世界
    // 在场，顶栏也不渲染任何世界信号触发器（信息归右栏 WorldCard，断言在
    // WorldSignals.test / WidgetRail.test）。新旧 testid 双保险防回归。
    expect(screen.queryByTestId('menubar-world-signals')).toBeNull()
    expect(screen.queryByTestId('widgets-world-signals')).toBeNull()
    expect(screen.queryByText(/趋势信号/)).toBeNull()
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

  it('traps Tab inside the shortcuts dialog (E2 审查)', () => {
    render(<MenuBar />)
    fireEvent.click(screen.getByRole('button', { name: '帮助' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '键盘快捷键' }))
    const close = screen.getByRole('button', { name: '知道了' })
    expect(document.activeElement).toBe(close)

    // 只有「知道了」一个可聚焦元素：Tab/Shift+Tab 都必须被拦下，
    // 不得跑进背景顶栏/窗口（aria-modal 的焦点陷阱）。
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(close)
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(close)
  })

  it('does not steal focus from the shortcuts dialog on every clock tick (E2 审查)', () => {
    render(<MenuBar />)
    fireEvent.click(screen.getByRole('button', { name: '帮助' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '键盘快捷键' }))
    const close = screen.getByRole('button', { name: '知道了' })
    const focusSpy = vi.spyOn(close, 'focus')

    // 顶栏时钟每秒重渲染；对话框的挂载 effect 不得随之重跑并重新 focus。
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(focusSpy).not.toHaveBeenCalled()
    focusSpy.mockRestore()
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

  it('truncates long display names and hides the date below sm (E2 审查)', () => {
    seedSessionForTests({
      id: 'u1',
      username: 'alice',
      displayName: '超长的显示名称'.repeat(6),
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    render(<MenuBar />)

    const userButton = screen.getByRole('button', { name: /超长的显示名称/ })
    const name = userButton.querySelector('span')
    expect(name?.className).toContain('truncate')
    expect(name?.className).toContain('max-w-24')

    // 窄屏只留时间：日期 span 在 sm 以下隐藏，时钟不被挤出视口。
    const date = screen.getByTestId('menu-bar-clock').querySelector('span')
    expect(date?.className).toContain('hidden')
    expect(date?.className).toContain('sm:inline')
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

  it('floats bare on the wallpaper — no bar background（2026-10-06 用户裁决）', () => {
    render(<MenuBar />)

    // 材质（2026-10-06 裁决：顶栏背景退役）：desktop-chrome 白字域保留，
    // glass-hint/surface-glass 底、发丝底边、投影全部退出——菜单直接浮于
    // 壁纸，与窄轨图标同供建构「原生桌面」感；下拉弹层仍走 popover 玻璃。
    const header = screen.getByTestId('menu-bar')
    expect(header.classList.contains('desktop-chrome')).toBe(true)
    for (const cls of ['surface-glass', 'glass-hint', 'border-b', 'shadow-soft']) {
      expect(header.classList.contains(cls), `menu bar must not carry ${cls}`).toBe(false)
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
