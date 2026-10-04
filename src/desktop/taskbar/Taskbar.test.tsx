import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetUsageStore, useUsageStore } from '@/store/usage-store'
import { resetAppStore } from '@/store/app-store'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { resetLauncherStore } from '@/store/launcher-store'

import { Taskbar } from './Taskbar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T10:30:00'))
  resetWindowStore()
  resetAppStore()
  resetDynamicDesktopStore()
  resetUsageStore()
  resetLauncherStore()
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

  it('keeps the preview alive while the pointer moves into it（2026-10-02 裁决：悬停桥）', async () => {
    const { act } = await import('@testing-library/react')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    const item = screen.getByRole('button', { name: '记事' })
    const wrapper = item.parentElement as HTMLElement
    fireEvent.mouseEnter(wrapper)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.getByTestId('window-preview')).toBeInTheDocument()

    // 离开图标：预览不立即消失（240ms 宽限桥）。
    fireEvent.mouseLeave(wrapper)
    expect(screen.getByTestId('window-preview')).toBeInTheDocument()

    // 宽限期内移入预览：取消收卡，驻留稳定。
    fireEvent.mouseEnter(screen.getByTestId('window-preview'))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByTestId('window-preview')).toBeInTheDocument()

    // 离开预览：宽限后收卡。
    fireEvent.mouseLeave(screen.getByTestId('window-preview'))
    act(() => {
      vi.advanceTimersByTime(300)
    })
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
    // 悬停桥（2026-10-02 裁决）：离开图标不立即收卡——240ms 宽限后收。
    expect(screen.getByTestId('window-preview')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(300)
    })
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

    // 采纳后的菜单：档位宽度 + 重置入口；分类芯片照常。
    expect(screen.getByTestId('launcher-layout-double')).toBeInTheDocument()
    expect(screen.getByTestId('launcher-layout-reset')).toBeInTheDocument()
    expect(screen.getByTestId('launcher-category-recent')).toBeInTheDocument()

    // 从网格启动应用照常工作（建议成员排序在前列；STEP 8 起面板含
    // Pinned 行等 6 列网格，取 Categories 区的末位网格）。
    const menu = screen.getByTestId('launcher-layout-double')
    const grids = menu.querySelectorAll('ul.grid')
    expect(grids.length).toBeGreaterThan(1)
    const grid = grids[grids.length - 1] as HTMLElement
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
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: '记' } })
    // STEP 8：搜索态是独立的结果网格（浏览网格卸载重挂），输入后重新取位。
    const grid = within(screen.getByTestId('launcher-grid'))
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

  it('renders the launcher on paper (ink text), not in the white-on-glass chrome scope', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    // UI 评审 P0-1：弹层改纸面（白玻璃 + 墨字），面板自身不再挂 desktop-chrome；
    // placeholder 用 tertiary 墨色（纸面上 ≥4.5:1），⌘K 徽章按平台显示。
    const input = screen.getByTestId('launcher-search')
    const menu = input.closest('menu') as HTMLElement
    expect(menu.classList.contains('popover-panel')).toBe(true)
    expect(menu.classList.contains('desktop-chrome')).toBe(false)
    expect(input.classList.contains('placeholder:text-text-tertiary')).toBe(true)
    expect(input.classList.contains('bg-surface-elevated')).toBe(true)
    const kbd = screen.getByTestId('launcher-search-kbd')
    expect(kbd.classList.contains('text-[11px]')).toBe(true)
    // jsdom 的 navigator.platform 为空 → 非 Apple → Ctrl+K。
    expect(kbd.textContent).toBe('Ctrl+K')
  })

  it('focuses the launcher search on open so typing filters immediately', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    expect(document.activeElement).toBe(screen.getByTestId('launcher-search'))
  })

  it('closes the launcher on an outside press and keeps it open for inside presses', () => {
    render(
      <>
        <Taskbar />
        <p>desktop</p>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    fireEvent.pointerDown(screen.getByTestId('launcher-search'))
    expect(screen.getByTestId('launcher-search')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByText('desktop'))
    expect(screen.queryByTestId('launcher-search')).not.toBeInTheDocument()
  })

  it('returns focus to the start button when Escape closes the launcher', () => {
    render(<Taskbar />)
    const start = screen.getByRole('button', { name: /开始/ })
    fireEvent.click(start)

    fireEvent.keyDown(screen.getByTestId('launcher-search'), { key: 'Escape' })

    expect(screen.queryByTestId('launcher-search')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(start)
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
    // Shell 2.0 浮动节奏：运动层高 = 胶囊 68 + 离底 20（token 计算式）。
    expect(bar.className).toContain('h-[calc(var(--ag-dock-height)+var(--ag-dock-gap))]')
    expect(bar.className).toContain('pb-[var(--ag-dock-gap)]')

    // 胶囊本体（材质表④）：玻璃 + 白22% 胶囊底 + 24px 圆角矩形（Shell 3.0
    // STEP 6，§33.2 档——全 pill 退役）+ 强细边 + shadow-dock 专用档 + 接指针；
    // 自动隐藏不复活（§32 修订 8）。
    const pill = bar.firstElementChild as HTMLElement
    for (const cls of [
      'surface-glass',
      'dock-glass',
      'rounded-[var(--ag-dock-radius)]',
      'border',
      'border-border-strong',
      'shadow-dock',
      'pointer-events-auto',
      'h-[var(--ag-dock-height)]',
    ]) {
      expect(pill.classList.contains(cls), cls).toBe(true)
    }
    // 材质配额：胶囊不得借弹层的 shadow-popover / 左栏的 shadow-float。
    expect(pill.classList.contains('shadow-popover')).toBe(false)
    expect(pill.classList.contains('shadow-float')).toBe(false)
  })

  it('scales the dock up to the shell 2.0 rhythm (68 capsule / 48 buttons / 48 icons / 56 pitch)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.dynamic.panel', title: '动态面板' })
    render(<Taskbar />)

    // 胶囊 68px（token）；瓷贴段与运行中段 gap-2（节距 56 = 48 + 8，σ44 波浪前提）；
    // 运行项按钮 48×48、图标 48（token --ag-dock-icon）。
    const pill = (screen.getByRole('contentinfo') as HTMLElement).firstElementChild as HTMLElement
    expect(pill.classList.contains('h-[var(--ag-dock-height)]')).toBe(true)
    const button = screen.getByTestId(
      `taskbar-item-${useWindowStore.getState().windows[0]!.id}`,
    )
    expect(button.className).toContain('h-12')
    expect(button.className).toContain('w-12')
    // Active 指示条（Shell 3.0 STEP 6）：聚焦窗口底部 2px×16px 细条（原 4px 点），
    // 恒为 primary（Active/Selected 配额）。
    const indicator = button.querySelector('.bg-primary') as HTMLElement
    expect(indicator).not.toBeNull()
    expect(indicator.className).toContain('h-0.5')
    expect(indicator.className).toContain('w-4')
    // 三类按钮（瓷贴/运行中/回收站）挂 dock-tile：hover 规则的域标记。
    expect(button.classList.contains('dock-tile')).toBe(true)
    expect(screen.getByTestId('dock-pin-com.ageha.files').classList.contains('dock-tile')).toBe(true)
    expect(screen.getByTestId('dock-trash').classList.contains('dock-tile')).toBe(true)
    const icon = button.querySelector('[data-wave-icon] span') as HTMLElement
    expect(icon.style.width).toBe('48px')
    expect(icon.style.height).toBe('48px')
    // 悬停浮起域不变：运行中图标的 data-wave-icon 包裹层仍是 CSS 钩子
    // （2026-10-02 裁决：只浮起被悬浮的一枚，引擎已退役）。
    expect(button.querySelector('[data-wave-icon]')).not.toBeNull()
  })

  it('opens the launcher as a centered large glass panel (Shell 3.0 STEP 8)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    const search = screen.getByTestId('launcher-search')
    const menu = search.closest('menu') as HTMLElement
    // 居中：pointer-events-none 满视口容器 + 上（菜单栏带）下（Dock 带）
    // 让位后取视觉中心；portal 到 body（包含块恒为视口，坑 13）。
    expect(menu.className).toContain('w-[600px]')
    expect(menu.className).toContain('max-w-[calc(100vw-1.5rem)]')
    // 尺寸恒定（2026-10-02 裁决：分类切换面板不变形）；高度 520px（STEP 8
    // 居中档；min() 安全帽防短视口溢顶，内容内部滚动）。
    expect(menu.className).toContain('h-[min(520px,calc(100vh-13rem))]')
    expect(menu.className).not.toContain('max-h-')
    // 6 列网格 + 分类切换淡入微动（os-pop-in 契约不变）。
    expect(menu.querySelector('ul.grid')?.className).toContain('grid-cols-6')
    expect(menu.innerHTML).toContain('animate-os-pop-in')
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

    // 悬停浮起覆盖瓷贴：瓷贴图标 span 挂 data-wave-icon（CSS hover 规则的
    // 作用域，2026-10-02 起只浮起被悬浮的一枚，与运行中窗口同钩子）。
    expect(
      screen.getByTestId('dock-pin-com.ageha.files').querySelector('[data-wave-icon]'),
    ).not.toBeNull()

    // 名称气泡（2026-10-02 裁决：dock 气泡 = 左栏同款玻璃芯片，位于图标
    // 上方）：无运行中窗口的瓷贴显示；有窗口的让位给悬停预览；回收站显示
    // 提示语。原生 title 属性退役（aria-label 可达名不变）。
    const filesPin = screen.getByTestId('dock-pin-com.ageha.files')
    const filesBubble = filesPin.querySelector('.os-tooltip--dock') as HTMLElement | null
    expect(filesBubble?.textContent).toBe('文件')
    // 预览挂载在瓷贴 wrapper（无窗口时 WindowPreview 不出现）。
    expect(filesPin.className).toContain('group')
    expect(screen.getByTestId('dock-trash').querySelector('.os-tooltip--dock')?.textContent).toBeTruthy()

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

  it('keeps pinned tile names stable while their app runs (UI review P2-7)', () => {
    render(<Taskbar />)
    const pin = screen.getByTestId('dock-pin-com.ageha.files')
    const name = pin.getAttribute('aria-label')

    fireEvent.click(pin)
    act(() => {
      useWindowStore.getState().setTitle(useWindowStore.getState().windows[0]!.id, '文档 — 文件')
    })

    // 名称不随窗口标题漂移。原生 title 已退役（2026-10-02 裁决：dock 气泡
    // + 悬停预览接管——有运行窗口的瓷贴不出名称气泡，标题经预览头部呈现）。
    expect(pin.getAttribute('aria-label')).toBe(name)
    expect(pin.getAttribute('title')).toBeNull()
    expect(screen.getByRole('navigation', { name: '程序坞' })).toContainElement(pin)
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
