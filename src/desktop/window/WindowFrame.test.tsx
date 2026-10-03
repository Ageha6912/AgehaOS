import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetClosingGhosts } from './closing-ghosts'
import { resetMotionPrefsStore, useMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetEclosionStore, seedEclosionForTests } from '@/store/eclosion-store'

import { WindowLayer } from './WindowLayer'

beforeEach(() => {
  resetWindowStore()
  resetClosingGhosts()
  // §12 动效机械测试不掺窗口切换转场（额外 animate 调用会混进飞行序列）。
  resetMotionPrefsStore()
  useMotionPrefsStore.setState({ windowTilt: false })
})

describe('WindowFrame (via WindowLayer)', () => {
  it('offers eight-way drag resize handles（2026-10-02 裁决「自由改变大小」）', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)

    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      expect(screen.getByTestId(`window-resize-${dir}`)).toBeInTheDocument()
    }
  })

  it('resizes from the south-east handle and clamps at min width', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)
    const before = useWindowStore.getState().windows[0]!
    const se = screen.getByTestId('window-resize-se')

    fireEvent.pointerDown(se, { button: 0, clientX: before.x + before.width, clientY: before.y + before.height })
    // 向内拖（-80/-40）：不受视口钳制影响的确定性断言。
    fireEvent.pointerMove(se, { clientX: before.x + before.width - 80, clientY: before.y + before.height - 40 })
    fireEvent.pointerUp(se)
    const after = useWindowStore.getState().windows[0]!
    expect(after.width).toBe(before.width - 80)
    expect(after.height).toBe(before.height - 40)

    // 反向拖过最小宽度：钳在 MIN_WINDOW_WIDTH=320，无半途尺寸。
    fireEvent.pointerDown(se, { button: 0, clientX: before.x + after.width, clientY: before.y + after.height })
    fireEvent.pointerMove(se, { clientX: before.x + 10, clientY: before.y + 10 })
    fireEvent.pointerUp(se)
    expect(useWindowStore.getState().windows[0]!.width).toBe(320)
  })

  it('compensates position when resizing from the west handle', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)
    const before = useWindowStore.getState().windows[0]!
    const west = screen.getByTestId('window-resize-w')

    // 西缘向右拖 60：宽度 -60、x +60（左缘跟手）。
    fireEvent.pointerDown(west, { button: 0, clientX: before.x, clientY: before.y + 200 })
    fireEvent.pointerMove(west, { clientX: before.x + 60, clientY: before.y + 200 })
    fireEvent.pointerUp(west)
    const after = useWindowStore.getState().windows[0]!
    expect(after.width).toBe(before.width - 60)
    expect(after.x).toBe(before.x + 60)
  })

  it('hides resize handles while maximized', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    act(() => {
      useWindowStore.getState().toggleMaximize(useWindowStore.getState().windows[0]!.id)
    })
    render(<WindowLayer />)
    expect(screen.queryByTestId('window-resize-se')).toBeNull()
  })

  it('renders macOS-style traffic lights on the left (§21, Q4 ruling)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)

    const region = screen.getByRole('region', { name: '记事' })
    // 头部 44px + 窗体 radius-xl（非最大化）。
    const header = region.querySelector('header') as HTMLElement
    expect(header.classList.contains('h-9')).toBe(true)
    // 2026-10-02 用户裁决：拖动区保持默认箭头（cursor-move 十字观感差）。
    expect(header.className).not.toContain('cursor-move')
    expect(region.classList.contains('rounded-xl')).toBe(true)

    // 三灯左置且顺序固定：关闭 → 最小化 → 最大化；点色走 Token。
    const close = screen.getByRole('button', { name: '关闭窗口' })
    const minimize = screen.getByRole('button', { name: '最小化窗口' })
    const maximize = screen.getByRole('button', { name: '最大化窗口' })
    expect(header.contains(close)).toBe(true)
    expect(close.compareDocumentPosition(minimize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      minimize.compareDocumentPosition(maximize) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(close.querySelector('.bg-wl-close')).not.toBeNull()
    expect(minimize.querySelector('.bg-wl-min')).not.toBeNull()
    expect(maximize.querySelector('.bg-wl-max')).not.toBeNull()
    // 2026-10-02 用户裁决：灯内不再有 ✕/—/⬛ 字形（纯色圆点，macOS 素态）；
    // 悬停 = 圆点轻微上浮 + 微放大提示可点（group-hover/light）；可访问名
    // 契约（上方 getByRole）不受影响。
    for (const light of [close, minimize, maximize]) {
      expect(light.querySelector('svg')).toBeNull()
      const dot = light.querySelector('span[aria-hidden="true"]') as HTMLElement
      expect(dot.className).toContain('group-hover/light:-translate-y-px')
      expect(dot.className).toContain('group-hover/light:scale-110')
      expect(light.className).toContain('group/light')
    }
    // 灯在 AppIcon/标题之前（左置）：灯组是 header 第一个子元素。
    const firstGroup = header.firstElementChild as HTMLElement
    expect(firstGroup.contains(close)).toBe(true)
    expect(firstGroup.contains(maximize)).toBe(true)
    expect(
      firstGroup.compareDocumentPosition(header.querySelector('span.truncate') as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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

  it('maximized window covers the entire viewport above all chrome (2026-10-02 verdict)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })

    const { container } = render(<WindowLayer />)
    const layer = container.firstElementChild as HTMLElement
    // 常态：窗口层 z-30，压不过浮层栏（z-40 chrome）。
    expect(layer.className).toContain('z-30')

    fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }))

    // 几何：整视口真全屏（inset-0）——盖过菜单栏带与 Dock 带，无系统栏留边。
    const region = screen.getByRole('region', { name: '记事' })
    expect(region.className).toContain('inset-0')
    expect(region.className).toContain('rounded-none')
    expect(region.className).not.toContain('rail-left-width')
    expect(region.className).not.toContain('rail-right-width')
    expect(region.className).not.toContain('menubar-height')

    // 层级：存在最大化窗口（含退场 ghost）时整层抬到 z-[45]，盖过全部
    // z-40 chrome（菜单栏/Dock/左右浮层栏）；还原走窗口标题栏。
    expect(layer.className).toContain('z-[45]')
  })

  it('wears the shell 2.0 window skin: deep glass face with OS-level focus hierarchy', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<WindowLayer />)

    // 材质表⑤：半透明面 + glass-deep（36px 深玻璃）；radius-xl(20px) 契约
    // 不变（简报 16-20 区间）；最大化 inset-0 rounded-none 全屏契约不受影响。
    const focused = screen.getByRole('region', { name: '文件' })
    expect(focused.classList.contains('surface-glass')).toBe(true)
    expect(focused.classList.contains('glass-deep')).toBe(true)
    expect(focused.classList.contains('rounded-xl')).toBe(true)
    expect(focused.classList.contains('inset-0')).toBe(false)
    // 聚焦 = primary/50 描边 + shadow-window；失焦 = 常规边框 + window-flat
    // （active/inactive 层级：像 OS 窗口，不像网页卡片）。
    expect(focused.classList.contains('border-primary/50')).toBe(true)
    expect(focused.classList.contains('shadow-window')).toBe(true)
    const unfocused = screen.getByRole('region', { name: '记事' })
    expect(unfocused.classList.contains('border-border')).toBe(true)
    expect(unfocused.classList.contains('shadow-window-flat')).toBe(true)
    expect(unfocused.classList.contains('glass-deep')).toBe(true)
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

  it('dims unfocused windows while the focus-switch transition is on (§32.5 修订 10)', () => {
    useMotionPrefsStore.setState({ windowTilt: true })
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })

    render(<WindowLayer />)

    // 失焦窗口微退后（CSS 类），聚焦窗口不带。
    expect(screen.getByRole('region', { name: '记事' }).className).toContain('is-tilt-dim')
    expect(screen.getByRole('region', { name: '文件' }).className).not.toContain('is-tilt-dim')

    // 焦点迁移后退后标记随之移动；最小化窗口不退后（本来隐藏）。
    act(() => {
      useWindowStore
        .getState()
        .focus(
          useWindowStore.getState().windows.find((w) => w.appId === 'com.ageha.notes')?.id ?? '',
        )
    })
    expect(screen.getByRole('region', { name: '记事' }).className).not.toContain('is-tilt-dim')
    expect(screen.getByRole('region', { name: '文件' }).className).toContain('is-tilt-dim')
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

  it('routes eclosion app ids to the eclosion host before the Type B allowlist (§3.2 路由顺序)', () => {
    // 开关关：宿主直接渲染原生兜底（不是 MissingApp、不是 WebAppFrame）。
    resetEclosionStore()
    useWindowStore.getState().open({ appId: 'com.ageha.eclosion.calculator', title: '计算器' })
    render(<WindowLayer />)

    expect(screen.getByTestId('calculator-display')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
    // 标题栏配件：重新羽化入口在场（AI 徽标已按 2026-10-03 裁决移除）。
    expect(screen.getByTestId('eclosion-regenerate')).toBeInTheDocument()
    expect(screen.queryByTestId('eclosion-ai-badge')).toBeNull()
    expect(screen.queryByText('未找到该应用，窗口即将关闭。')).not.toBeInTheDocument()
    resetEclosionStore()
  })

  it('renders the sandboxed runner iframe for eclosion apps when the mode is on', () => {
    seedEclosionForTests('u-frame-route', true)
    useWindowStore.getState().open({ appId: 'com.ageha.eclosion.calculator', title: '计算器' })
    render(<WindowLayer />)

    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('src')).toMatch(/^\/apps\/runtime\/eclosion\.html\?v=/)
    resetEclosionStore()
  })

  it('title-bar drag never hijacks presses on portal dialogs (举报同意框, P4 §10)', () => {
    // 复现口径（2026-10-03 E2E 实测）：羽化举报同意框 createPortal 到 body，其
    // pointerdown 经 React 树冒泡到达标题栏 onPointerDown；若照常
    // setPointerCapture，后续 pointerup/click 被重定到标题栏，同意框按钮的
    // onClick 收不到（真实浏览器里取消/确认双双失效）。守卫后：portal 按压
    // 不是标题栏 DOM 后代 → 直接放过。
    resetEclosionStore()
    useWindowStore.getState().open({ appId: 'com.ageha.eclosion.calculator', title: '计算器' })
    render(<WindowLayer />)

    // 打开同意框（触发按钮本身已吞 pointerdown，开框不受影响）。
    fireEvent.click(screen.getByTestId('eclosion-report'))
    const dialog = screen.getByRole('dialog', { name: '举报此应用' })
    expect(dialog.parentElement).toBe(document.body) // portal 出根容器

    // portal 按压不劫持指针、不进拖拽态。jsdom 本无 setPointerCapture——补一个
    // 探针实现：守卫在场时**绝不能被调**（未守卫时它就是劫持点，且真实浏览器
    // 里后续 pointerup/click 会被重定到标题栏）。
    const capture = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: capture,
      configurable: true,
    })
    const before = useWindowStore.getState().windows[0]
    expect(() =>
      fireEvent.pointerDown(within(dialog).getByTestId('confirm-dialog-cancel')),
    ).not.toThrow()
    expect(capture, 'portal 按压不得 setPointerCapture').not.toHaveBeenCalled()
    const after = useWindowStore.getState().windows[0]
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y })
    delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture

    // 取消照常关闭（onClick 完整事件链不被劫持）。
    fireEvent.click(within(dialog).getByTestId('confirm-dialog-cancel'))
    expect(screen.queryByRole('dialog', { name: '举报此应用' })).not.toBeInTheDocument()
    resetEclosionStore()
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
