import { fireEvent, render, screen } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('button', { name: /记事/ }))

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

  it('renders adopted layout groups in the start menu and can launch from them', () => {
    useDynamicDesktopStore.getState().applyLayout({
      layoutId: 'layout-taskbar-test',
      tier: 'double',
      groups: [{ nameKey: 'tools', appIds: ['com.ageha.calculator', 'com.ageha.dynamic.panel'] }],
    })
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    // 采纳后的菜单：档位标识 + 分组标题 + 系统组（永不随机清单仍在顶部）。
    expect(screen.getByTestId('launcher-layout-double')).toBeInTheDocument()
    expect(screen.getByText('工具')).toBeInTheDocument()
    expect(screen.getByText('系统')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument()

    // 从分组内启动应用照常工作。
    fireEvent.click(screen.getByRole('button', { name: /计算器/ }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.calculator')
  })

  it('keeps the flat start menu when no layout is adopted', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))

    expect(screen.queryByText('工具')).not.toBeInTheDocument()
    expect(screen.queryByText('系统')).not.toBeInTheDocument()
  })

  it('filters the flat launcher by the local search box (§22)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: '记' } })
    expect(screen.getByRole('button', { name: '记事' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '文件' })).not.toBeInTheDocument()

    // 命中即启动；输入随菜单关闭清空。
    fireEvent.click(screen.getByRole('button', { name: '记事' }))
    expect(useWindowStore.getState().windows[0]?.appId).toBe('com.ageha.notes')

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    expect(screen.getByTestId('launcher-search')).toHaveValue('')
  })

  it('shows the recent section in the flat launcher and hides it while searching (§22)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().close(useWindowStore.getState().windows[0]!.id)
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    expect(screen.getByText('最近')).toBeInTheDocument()
    // 最近区瓦片可启动。
    fireEvent.click(screen.getByTestId('launcher-recent-item'))
    expect(useWindowStore.getState().windows.some((win) => win.appId === 'com.ageha.notes')).toBe(true)

    // 搜索态隐藏最近区（结果即目标，最近是浏览辅助）。
    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    useUsageStore.getState().recordRecentApp('com.ageha.notes')
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: '文件' } })
    expect(screen.queryByText('最近')).not.toBeInTheDocument()
  })

  it('shows the empty state when the launcher search misses', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    fireEvent.change(screen.getByTestId('launcher-search'), { target: { value: 'zzz' } })

    expect(screen.getByText('无匹配结果')).toBeInTheDocument()
  })

  it('auto-hides by default and slides in from the bottom edge zone', () => {
    render(<Taskbar />)

    const bar = screen.getByRole('contentinfo') as HTMLElement
    expect(bar).toHaveAttribute('data-state', 'hidden')
    expect(bar.style.transform).toBe('translateY(100%)')

    fireEvent.pointerEnter(screen.getByTestId('taskbar-reveal-zone'))
    expect(bar).toHaveAttribute('data-state', 'revealed')
    expect(bar.style.transform).toBe('translateY(0)')
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

  it('scales the dock up to the Round 2 reference prominence (§31)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    // 胶囊 64px；运行项按钮 48×48（节距 52 = w-12 + gap-1，σ44 波浪前提）、图标 40。
    const pill = (screen.getByRole('contentinfo') as HTMLElement).firstElementChild as HTMLElement
    expect(pill.className).toContain('h-16')
    const button = screen.getByTestId(
      `taskbar-item-${useWindowStore.getState().windows[0]!.id}`,
    )
    expect(button.className).toContain('h-12')
    expect(button.className).toContain('w-12')
    const icon = button.querySelector('[data-wave-icon] span') as HTMLElement
    expect(icon.style.width).toBe('40px')
    expect(icon.style.height).toBe('40px')
  })

  it('opens the launcher as a centered wide panel above the dock (§31/§17)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    const search = screen.getByTestId('launcher-search')
    const menu = search.closest('menu') as HTMLElement
    // 水平居中（Spotlight 式），锚在 Dock 上方，宽 36rem、6 列网格。
    expect(menu.className).toContain('left-1/2')
    expect(menu.className).toContain('-translate-x-1/2')
    expect(menu.className).toContain('bottom-[calc(var(--ag-dock-height)+1.5rem)]')
    expect(menu.querySelector('ul.grid')?.className).toContain('grid-cols-6')
  })

  it('closes the launcher on Escape (§24 popover contract)', () => {
    render(<Taskbar />)

    fireEvent.click(screen.getByRole('button', { name: /开始/ }))
    expect(screen.getByTestId('launcher-search')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('launcher-search'), { key: 'Escape' })
    // 无 WAAPI 运行时退场即时卸载（jsdom）。
    expect(screen.queryByTestId('launcher-search')).not.toBeInTheDocument()
  })

  it('hides again after the pointer leaves, and re-entering cancels the hide', async () => {
    const { act } = await import('@testing-library/react')
    render(<Taskbar />)

    const bar = screen.getByRole('contentinfo') as HTMLElement
    fireEvent.pointerEnter(screen.getByTestId('taskbar-reveal-zone'))
    expect(bar).toHaveAttribute('data-state', 'revealed')

    fireEvent.pointerLeave(bar)
    // 400ms 缓冲内回到任务栏（或再触底）→ 不收起。
    fireEvent.pointerEnter(bar)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(bar).toHaveAttribute('data-state', 'revealed')

    fireEvent.pointerLeave(bar)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(bar).toHaveAttribute('data-state', 'hidden')
  })

  it('hides when the pointer leaves the reveal zone without entering the bar', async () => {
    const { act } = await import('@testing-library/react')
    render(<Taskbar />)

    const bar = screen.getByRole('contentinfo') as HTMLElement
    const zone = screen.getByTestId('taskbar-reveal-zone')

    fireEvent.pointerEnter(zone)
    expect(bar).toHaveAttribute('data-state', 'revealed')

    // 真实浏览器：任务栏滑到静止指针下方时不发 enter，直接跳走只触发
    // 唤出区的 leave——这条路径也必须收起。
    fireEvent.pointerLeave(zone)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(bar).toHaveAttribute('data-state', 'hidden')
  })

  it('reveals for keyboard focus and hides when focus leaves the taskbar', async () => {
    const { act } = await import('@testing-library/react')
    // 尾部系统状态已迁往顶栏（§19）——焦点链用窗口项按钮验证。
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Taskbar />)

    const bar = screen.getByRole('contentinfo') as HTMLElement
    const start = screen.getByRole('button', { name: /开始/ })

    fireEvent.focus(start)
    expect(bar).toHaveAttribute('data-state', 'revealed')

    // 焦点移向任务栏内的另一个控件（窗口项按钮）不收起。
    const item = bar.querySelectorAll('button')[1] as HTMLElement
    fireEvent.blur(start, { relatedTarget: item })
    fireEvent.focus(item)
    expect(bar).toHaveAttribute('data-state', 'revealed')

    fireEvent.blur(item, { relatedTarget: document.body })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(bar).toHaveAttribute('data-state', 'hidden')
  })
})
