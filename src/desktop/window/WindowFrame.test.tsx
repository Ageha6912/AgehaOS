import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetClosingGhosts } from './closing-ghosts'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { WindowLayer } from './WindowLayer'

beforeEach(() => {
  resetWindowStore()
  resetClosingGhosts()
})

describe('WindowFrame (via WindowLayer)', () => {
  it('renders macOS-style traffic lights on the left (§21, Q4 ruling)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)

    const region = screen.getByRole('region', { name: '记事' })
    // 头部 44px + 窗体 radius-xl（非最大化）。
    const header = region.querySelector('header') as HTMLElement
    expect(header.classList.contains('h-9')).toBe(true)
    expect(region.classList.contains('rounded-xl')).toBe(true)

    // 三灯左置且顺序固定：关闭 → 最小化 → 最大化；点色走 Token。
    const close = screen.getByRole('button', { name: '关闭窗口' })
    const minimize = screen.getByRole('button', { name: '最小化窗口' })
    const maximize = screen.getByRole('button', { name: '最大化窗口' })
    expect(header.contains(close)).toBe(true)
    expect(close.compareDocumentPosition(minimize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(minimize.compareDocumentPosition(maximize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(close.querySelector('.bg-wl-close')).not.toBeNull()
    expect(minimize.querySelector('.bg-wl-min')).not.toBeNull()
    expect(maximize.querySelector('.bg-wl-max')).not.toBeNull()
    // 灯在 AppIcon/标题之前（左置）：灯组是 header 第一个子元素。
    const firstGroup = header.firstElementChild as HTMLElement
    expect(firstGroup.contains(close)).toBe(true)
    expect(firstGroup.contains(maximize)).toBe(true)
    expect(firstGroup.compareDocumentPosition(header.querySelector('span.truncate') as Node)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the title bar and app body', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100 })

    render(<WindowLayer />)

    expect(screen.getByRole('region', { name: '记事' })).toBeInTheDocument()
    expect(screen.getByText('选择或新建一条笔记')).toBeInTheDocument()
  })

  it('closes the window via the close button', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))

    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('minimizes the window via the minimize button', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)

    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))

    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
  })

  it('toggles maximize via the maximize button and double-click on the title bar', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100 })

    render(<WindowLayer />)

    fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')

    fireEvent.click(screen.getByRole('button', { name: '还原窗口' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
    expect(useWindowStore.getState().windows[0]?.x).toBe(100)

    fireEvent.doubleClick(screen.getByText('记事'))
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')
  })

  it('maximized window spans edge-to-edge between menubar and dock, and lifts the layer over the floating rails (2026-10-01 verdict)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    const { container } = render(<WindowLayer />)
    const layer = container.firstElementChild as HTMLElement
    // 常态：窗口层 z-30，压不过浮层栏（z-40 chrome）。
    expect(layer.className).toContain('z-30')

    fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }))

    // 几何：横向全幅贴左右屏幕边缘（不再扣左栏/右栏宽），上贴菜单栏下界、
    // 下贴 Dock 边界（--ag-dock-height + 0.75rem footer 高）。
    const region = screen.getByRole('region', { name: '记事' })
    expect(region.className).toContain('left-0')
    expect(region.className).toContain('w-full')
    expect(region.className).toContain(
      'h-[calc(100%_-_var(--ag-menubar-height)_-_var(--ag-dock-height)_-_0.75rem)]',
    )
    expect(region.className).not.toContain('rail-left-width')
    expect(region.className).not.toContain('rail-right-width')

    // 层级：存在最大化窗口（含退场 ghost）时整层抬到 z-[45]，盖过左栏/
    // 小组件栏（z-40）；菜单栏/Dock 几何上无重叠，照常可用。
    expect(layer.className).toContain('z-[45]')
  })

  it('focuses the window on pointer down', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })

    render(<WindowLayer />)
    expect(
      useWindowStore.getState().windows.find((win) => win.appId === 'com.ageha.notes')?.focused,
    ).toBe(false)

    fireEvent.pointerDown(screen.getByRole('region', { name: '记事' }))

    expect(
      useWindowStore.getState().windows.find((win) => win.appId === 'com.ageha.notes')?.focused,
    ).toBe(true)
  })

  it('keeps a minimized window mounted but hidden', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)
    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))

    const region = screen.getByRole('region', { name: '记事' })
    expect(region).toBeInTheDocument()
    expect(region.className).toContain('hidden')
  })

  it('hides the maximize button for non-resizable windows', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', resizable: false })

    render(<WindowLayer />)

    expect(screen.queryByRole('button', { name: '最大化窗口' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最小化窗口' })).toBeInTheDocument()
  })

  it('renders a fallback body when the app is not registered', () => {
    useWindowStore.getState().open({ appId: 'ghost', title: 'Ghost' })

    render(<WindowLayer />)

    expect(screen.getByText('未找到该应用，窗口即将关闭。')).toBeInTheDocument()
  })
})

/**
 * WAAPI 路径（DESIGN.md §12）：替换 Element.prototype.animate 为可控替身，
 * 验证飞行编排——jsdom 默认无 animate（上方用例即降级直落定路径）。
 */
describe('WindowFrame 窗口动效（WAAPI 就绪）', () => {
  interface FakeFlight {
    resolve: () => void
    reverse: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  const flights: FakeFlight[] = []
  let animateMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    flights.length = 0
    animateMock = vi.fn(() => {
      let resolve!: () => void
      const finished = new Promise<void>((r) => {
        resolve = r
      })
      const flight = {
        finished,
        reverse: vi.fn(),
        cancel: vi.fn(),
      }
      flights.push({ resolve, reverse: flight.reverse, cancel: flight.cancel })
      return flight
    })
    ;(Element.prototype as unknown as { animate?: unknown }).animate = animateMock
  })

  afterEach(() => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate
  })

  const getRegion = (title: string) => screen.getByRole('region', { name: title })

  it('plays the open flight on mount from the taskbar direction', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)

    expect(animateMock).toHaveBeenCalledTimes(1)
    const [frames, options] = animateMock.mock.calls[0] as unknown as [
      { transform: string; opacity: number }[],
      { duration: number; easing: string; fill: string },
    ]
    expect(frames[0]).toEqual({ transform: 'scale(0.9)', opacity: 0 })
    expect(options.duration).toBe(200)
    expect(options.easing).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
  })

  it('commits close immediately; the aria-hidden ghost finishes the exit flight', async () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { container } = render(<WindowLayer />)
    await act(async () => {
      flights[0].resolve() // 打开飞行先落定
    })

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))
    // store 即刻提交（引擎/任务栏/启动逻辑立刻见到真相）
    expect(useWindowStore.getState().windows).toHaveLength(0)
    // ghost 壳仍在 DOM 播退场，但已退出可达树、不再截胡指针
    const ghost = container.querySelector('section[aria-label="记事"]')
    expect(ghost).not.toBeNull()
    expect(ghost).toHaveAttribute('aria-hidden', 'true')
    expect(ghost?.className).toContain('pointer-events-none')

    await act(async () => {
      flights[1].resolve() // 退场飞行结束
    })
    expect(container.querySelector('section[aria-label="记事"]')).toBeNull()
  })

  it('keeps the reopened window uniquely addressable while the old one exits', async () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)
    await act(async () => {
      flights[0].resolve()
    })

    // 关闭（ghost 退场中）立刻重开同名应用
    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))
    act(() => {
      useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    })

    // 可达树里只有新窗口（ghost 已 aria-hidden）——不会 strict-mode 撞车
    expect(screen.getAllByRole('region', { name: '记事' })).toHaveLength(1)
    expect(useWindowStore.getState().windows).toHaveLength(1)

    await act(async () => {
      flights[1].resolve() // ghost 退场结束
    })
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('commits minimize immediately but holds the window visible through the genie flight', async () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)
    await act(async () => {
      flights[0].resolve() // 打开飞行落定
    })

    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))

    // store 先行提交（任务栏即刻反馈），表现层反压 hidden 类保持飞行可见
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
    const region = getRegion('记事')
    expect(region).toBeInTheDocument()
    expect(region.className).toContain('hidden')
    expect((region as HTMLElement).style.display).toBe('flex')
    expect(animateMock).toHaveBeenCalledTimes(2) // 打开 + genie
    const genieFrames = animateMock.mock.calls[1] as unknown as [
      { transform: string; opacity: number }[],
    ]
    expect(genieFrames[0]).toHaveLength(3) // 三关键帧位移飞行

    await act(async () => {
      flights[1].resolve()
    })

    expect((region as HTMLElement).style.display).toBe('') // 交还 hidden 类接管
  })

  it('grabs a mid-flight minimize back to the desktop on restore (anim.reverse)', async () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)
    await act(async () => {
      flights[0].resolve() // 打开飞行先落定，genie 才是独立的最小化飞行
    })

    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))
    act(() => {
      const current = useWindowStore.getState().windows[0]
      if (current) useWindowStore.getState().restore(current.id)
    })

    // 半途抓回：同一动画反向播放，而不是新建飞行
    expect(flights[1].reverse).toHaveBeenCalledTimes(1)
    expect(animateMock).toHaveBeenCalledTimes(2) // 打开 + genie（抓回不新建）
    expect((getRegion('记事') as HTMLElement).classList.contains('hidden')).toBe(false)

    await act(async () => {
      flights[1].resolve()
    })

    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
    expect((getRegion('记事') as HTMLElement).style.transform).toBe('') // 内联位姿已清
  })

  it('grabs a mid-flight restore back into the taskbar on minimize', async () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)

    // 第一段：完整最小化飞行落定
    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))
    await act(async () => {
      flights[0].resolve()
    })
    expect((getRegion('记事') as HTMLElement).className).toContain('hidden')

    // 第二段：还原飞行中途再次最小化 → 反向抓回
    act(() => {
      const current = useWindowStore.getState().windows[0]
      if (current) useWindowStore.getState().restore(current.id)
    })
    const restoreFlightCount = animateMock.mock.calls.length
    act(() => {
      const current = useWindowStore.getState().windows[0]
      if (current) useWindowStore.getState().minimize(current.id)
    })
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
    expect(flights[restoreFlightCount - 1].reverse).toHaveBeenCalledTimes(2) // 启动反向一次 + 抓回一次

    await act(async () => {
      flights[restoreFlightCount - 1].resolve()
    })
    expect((getRegion('记事') as HTMLElement).className).toContain('hidden')
  })

  it('skips all animation under prefers-reduced-motion (instant terminal states)', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    render(<WindowLayer />)
    expect(animateMock).not.toHaveBeenCalled() // 打开直达终态

    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
    expect((getRegion('记事') as HTMLElement).className).toContain('hidden')
    expect(animateMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))
    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(animateMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
