import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import { resetAppStore } from '@/store/app-store'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'

import { Taskbar } from './Taskbar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  resetWindowStore()
  resetAppStore()
  resetDynamicDesktopStore()
  resetUsageStore()
})

describe('Taskbar', () => {
  it('launches an app from the start menu', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    // 常驻瓷贴与启动器瓦片同名——网格作用域内取瓦片。
    fireEvent.click(
      within(screen.getByTestId('launcher-grid')).getByRole('button', { name: /记事/ }),
    )

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe('com.ageha.notes')
    expect(windows[0]?.title).toBe('记事')
    expect(windows[0]?.width).toBe(720)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('minimizes the focused window and restores it from the taskbar', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: '记事' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')

    fireEvent.click(screen.getByRole('button', { name: '记事' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })

  it('focuses an unfocused window instead of minimizing it', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: '记事' }))

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.appId === 'com.ageha.notes')?.focused).toBe(true)
    expect(windows.find((win) => win.appId === 'com.ageha.files')?.focused).toBe(false)
  })

  it('shows running windows as icons without their titles', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    const item = screen.getByRole('button', { name: '记事' })
    expect(item.querySelector('svg')).not.toBeNull()
    expect(item.textContent).not.toContain('记事')
    // 聚焦窗口带指示条。
    expect(item.querySelector('.bg-primary')).not.toBeNull()
  })

  it('shows a hover preview with title, close and minimized state', async () => {
    const { act } = await import('@testing-library/react')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    const item = screen.getByRole('button', { name: '记事' })
    fireEvent.mouseEnter(item.parentElement as HTMLElement)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByTestId('window-preview')).toBeInTheDocument()
    expect(screen.getByTestId('window-preview').textContent).toContain('记事')
    // 预览经 createPortal 挂在 body 上：玻璃胶囊的 backdrop-filter 会劫持
    // fixed 包含块，把视口坐标的 left 推到屏幕右缘（坑 13 变体）。
    const preview = screen.getByTestId('window-preview')
    expect(preview.parentElement).toBe(document.body)
    expect(preview.closest('footer')).toBeNull()
    expect(preview.className).toContain('fixed')

    // 点击预览体切回窗口；再次悬停后用关闭按钮关窗。
    fireEvent.click(screen.getByTestId('window-preview'))
    expect(useWindowStore.getState().windows).toHaveLength(1)

    fireEvent.mouseEnter(item.parentElement as HTMLElement)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.click(screen.getByTestId('preview-close'))
    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(screen.queryByTestId('window-preview')).toBeNull()
  })

  it('shows the minimized state in the preview and hides it on mouse leave', async () => {
    const { act } = await import('@testing-library/react')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().minimize(useWindowStore.getState().windows[0]?.id ?? '')
    render(<Taskbar />)

    const item = screen.getByRole('button', { name: '记事' })
    fireEvent.mouseEnter(item.parentElement as HTMLElement)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByTestId('window-preview').textContent).toContain('窗口已最小化')

    fireEvent.mouseLeave(item.parentElement as HTMLElement)
    expect(screen.queryByTestId('window-preview')).toBeNull()
  })

  it('renders adopted layout tier width, keeps ordering, and can reset (§22/§32)', () => {
    useDynamicDesktopStore.getState().applyLayout({
      layoutId: 'layout-taskbar-test',
      tier: 'double',
      groups: [{ nameKey: 'tools', appIds: ['com.ageha.calculator', 'com.ageha.dynamic.panel'] }],
    })
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    // 采纳后的菜单：档位宽度 + 重置入口；分类轨照常。
    expect(screen.getByTestId('launcher-layout-double')).toBeInTheDocument()
    expect(screen.getByTestId('launcher-layout-reset')).toBeInTheDocument()
    expect(screen.getByTestId('launcher-category-recent')).toBeInTheDocument()

    // 从网格启动应用照常工作（建议成员排序在前列；限定网格 ul——推荐行也用应用名）。
    const menu = screen.getByTestId('launcher-layout-double')
    const grid = menu.querySelector('ul.grid') as HTMLElement
    fireEvent.click(within(grid).getByRole('button', { name: /计算器/ }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.calculator')
  })

  it('keeps the category rail with 最近使用 as the default selection (§32)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    expect(screen.getByTestId('launcher-category-recent').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('launcher-category-system')).toBeInTheDocument()
    // 空最近回落全部应用：网格瓦片可见（作用域限定网格防常驻瓷贴同名）。
    expect(
      within(screen.getByTestId('launcher-grid')).getByRole('button', { name: /记事/ }),
    ).toBeInTheDocument()
  })

  it('filters the flat launcher by the local search box (§22)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    const grid = within(screen.getByTestId('launcher-grid'))
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: '记' } })
    expect(grid.getByRole('button', { name: '记事' })).toBeInTheDocument()
    expect(grid.queryByRole('button', { name: '文件' })).not.toBeInTheDocument()

    // 命中即启动；输入随菜单关闭清空。
    fireEvent.click(grid.getByRole('button', { name: '记事' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.notes')

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    expect(screen.getByTestId('launcher-search')).toHaveValue('')
  })

  it('shows the recent category in the launcher and hides it while searching (§22/§32)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().close(useWindowStore.getState().windows[0]!.id)
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    // 最近分类默认选中且承载最近瓦片。
    expect(screen.getByTestId('launcher-category-recent').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('launcher-recent-item'))
    expect(useWindowStore.getState().windows.some((win) => win.appId === 'com.ageha.notes')).toBe(true)

    // 搜索态跨全应用，最近分类瓦片让位（结果即目标，最近是浏览辅助）。
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: '文件' } })
    expect(screen.queryByTestId('launcher-recent-item')).not.toBeInTheDocument()
  })

  it('shows the empty state when the launcher search misses', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: 'zzz' } })

    expect(screen.getByText('无匹配结果')).toBeInTheDocument()
  })

  it('常驻显示：默认可见且指针离开也不再隐藏（§32 修订 8）', () => {
    render(<Taskbar />)

    const bar = screen.getByRole('contentinfo') as HTMLElement
    // 常驻：无交互即 revealed，且不再有隐藏态。
    expect(bar).toHaveAttribute('data-state', 'revealed')
    fireEvent.pointerLeave(bar)
    expect(bar).toHaveAttribute('data-state', 'revealed')
  })

  it('renders as a centered floating glass dock (§20: full-width footer is a transparent motion layer)', () => {
    render(<Taskbar />)

    const bar = screen.getByRole('contentinfo') as HTMLElement
    // 运动层全宽透明：渐变纱退场，pointer-events-none 不截胡两侧窗口点击（坑 40）。
    expect(bar.className).not.toContain('from-bg/')
    expect(bar.classList.contains('pointer-events-none')).toBe(true)

    // 胶囊本体：玻璃 + pill + hairline + popover 影 + 接指针。
    const pill = bar.firstElementChild as HTMLElement
    expect(pill.classList.contains('surface-glass')).toBe(true)
    expect(pill.classList.contains('rounded-full')).toBe(true)
    expect(pill.classList.contains('border')).toBe(true)
    expect(pill.classList.contains('shadow-popover')).toBe(true)
    expect(pill.classList.contains('pointer-events-auto')).toBe(true)
  })

  it('scales the dock up to the §32 reference prominence (68 capsule / 48 buttons / 44 icons)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.dynamic.panel', title: '动态面板' })
    render(<Taskbar />)

    // 胶囊 64px；运行项按钮 48×48（节距 52 = w-12 + gap-1，σ44 波浪前提）、图标 44。
    const pill = (screen.getByRole('contentinfo') as HTMLElement).firstElementChild as HTMLElement
    expect(pill.className).toContain('h-16')
    const button = screen.getByTestId(
      `taskbar-item-${useWindowStore.getState().windows[0]!.id}`,
    )
    expect(button.className).toContain('h-12')
    expect(button.className).toContain('w-12')
    const icon = button.querySelector('[data-wave-icon] span') as HTMLElement
    expect(icon.style.width).toBe('44px')
    expect(icon.style.height).toBe('44px')
  })

  it('opens the launcher as a left-anchored two-pane panel above the dock (§32)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    const search = screen.getByTestId('launcher-search')
    const menu = search.closest('menu') as HTMLElement
    // 左侧锚定（贴左栏），锚在 Dock 上方，宽 410px、4 列网格。
    expect(menu.className).toContain('left-[calc(var(--ag-rail-left-width)+1.125rem)]')
    expect(menu.className).toContain('bottom-[calc(var(--ag-dock-height)+1.75rem)]')
    expect(menu.className).toContain('w-[410px]')
    expect(menu.querySelector('ul.grid')?.className).toContain('grid-cols-4')
  })

  it('pins the reference dock tiles with single-instance activation and a trash deep link', () => {
    render(<Taskbar />)

    // 常驻瓷贴在位（参考图 Dock 位）。
    expect(screen.getByTestId('dock-pin-com.ageha.files')).toBeInTheDocument()
    expect(screen.getByTestId('dock-pin-com.ageha.terminal')).toBeInTheDocument()

    // 瓷贴按钮不画 hover/active 底色（2026-10-01 用户裁决：浅底在 44px
    // 图标 + 48px 按钮的组合下显成图标四周的白边）。
    for (const id of ['files', 'terminal', 'settings']) {
      const pin = screen.getByTestId(`dock-pin-com.ageha.${id}`)
      expect(pin.className).not.toContain('bg-surface-raised')
    }
    expect(screen.getByTestId('dock-trash').className).not.toContain('bg-surface-raised')

    // 波浪域覆盖瓷贴（2026-10-01 用户报告「波浪没有了」）：瓷贴图标 span
    // 挂 data-wave-icon，与运行中窗口同引擎。
    expect(
      screen.getByTestId('dock-pin-com.ageha.files').querySelector('[data-wave-icon]'),
    ).not.toBeNull()

    // Dock 高光滑过覆盖层随偏好默认开（§32.5 修订 10）。
    expect(screen.getByTestId('dock-sheen')).toBeInTheDocument()

    // 运行中窗口行隐藏滚动条 UI（§32.5 修订 11：波浪 1.5× 变换边界会撑出
    // 可滚动区域，滚动条不得随悬停闪现），滚动能力保留。
    expect(screen.getByTestId('dock-running-row').className).toContain('no-scrollbar')

    // 单实例激活：点击瓷贴启动，再点聚焦窗口最小化，再点还原。
    fireEvent.click(screen.getByTestId('dock-pin-com.ageha.files'))
    const filesWindow = useWindowStore.getState().windows.find((w) => w.appId === 'com.ageha.files')
    expect(filesWindow).toBeDefined()
    fireEvent.click(screen.getByTestId('dock-pin-com.ageha.files'))
    expect(
      useWindowStore.getState().windows.find((w) => w.appId === 'com.ageha.files')?.state,
    ).toBe('minimized')
    fireEvent.click(screen.getByTestId('dock-pin-com.ageha.files'))
    expect(
      useWindowStore.getState().windows.find((w) => w.appId === 'com.ageha.files')?.state,
    ).toBe('normal')

    // 回收站：Files 深链直达回收站视图。
    fireEvent.click(screen.getByTestId('dock-trash'))
    expect(
      useWindowStore.getState().windows.some((win) => win.appId === 'com.ageha.files'),
    ).toBe(true)
  })

  it('closes the launcher on Escape (§24 popover contract)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    expect(screen.getByTestId('launcher-search')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('launcher-search'), { key: 'Escape' })
    // 无 WAAPI 运行时退场即时卸载（jsdom）。
    expect(screen.queryByTestId('launcher-search')).not.toBeInTheDocument()
  })

  it('常驻显示：自动隐藏机制（唤出区/收起定时器）已随 §32 修订 8 移除', () => {
    render(<Taskbar />)

    // 唤出区已不存在；footer 恒为 revealed，指针离开不改变状态。
    expect(screen.queryByTestId('taskbar-reveal-zone')).toBeNull()
    const bar = screen.getByRole('contentinfo') as HTMLElement
    fireEvent.pointerEnter(bar)
    fireEvent.pointerLeave(bar)
    expect(bar).toHaveAttribute('data-state', 'revealed')
  })
})
