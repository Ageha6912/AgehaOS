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
    // 头部 44px（Shell 3.0 STEP 7 档 44-50）+ 窗体圆角走 .spatial-window 体系
    // 28px 档（--sp-window-radius，2026-10-10 空间化裁决 2；rounded-xl 20px
    // 档退役），非最大化不挂 rounded-none。
    const header = region.querySelector('header') as HTMLElement
    expect(header.classList.contains('h-11')).toBe(true)
    // 2026-10-02 用户裁决：拖动区保持默认箭头（cursor-move 十字观感差）。
    expect(header.className).not.toContain('cursor-move')
    expect(region.classList.contains('spatial-window')).toBe(true)
    expect(region.classList.contains('rounded-none')).toBe(false)

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
    // 空间化（2026-10-10）：最大化 = 真全屏工作面——无深度类、无悬停浮起，
    // 挂 sp-win-max 直切零圆角（rounded-none 工具类在未分层规则前必败，
    // sp-win-max 是实效载体）。
    expect(region.className).not.toContain('sp-depth')
    expect(region.className).not.toContain('sp-win-hover')
    expect(region.classList.contains('sp-win-max')).toBe(true)

    // 层级：存在最大化窗口（含退场 ghost）时整层抬到 z-[45]，盖过全部
    // z-40 chrome（菜单栏/Dock/左右浮层栏）；还原走窗口标题栏。
    expect(layer.className).toContain('z-[45]')
  })

  it('wears the spatial window skin: sp glass system with the depth class stack (2026-10-10)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const { container } = render(<WindowLayer />)

    // 窗口层舞台透视（--sp-perspective）：只建立 3D 上下文，静止布局零影响
    // （E2E 几何探针契约；深度档在窗口作用域解析为非变换表达）。
    const layer = container.firstElementChild as HTMLElement
    expect(layer.style.perspective).toBe('var(--sp-perspective)')

    // 材质升级：.spatial-window 体系（28px 圆角档 / 40px 磨砂 / 斜向高光 /
    // 空间阴影 / 两处实色兜底在 spatial.css 自持源序）；旧 surface-glass +
    // glass-deep 组合与 rounded-xl 20px 档退役；非最大化无 rounded-none。
    const focused = screen.getByRole('region', { name: '文件' })
    expect(focused.classList.contains('spatial-window')).toBe(true)
    expect(focused.classList.contains('sp-win')).toBe(true)
    expect(focused.classList.contains('surface-glass')).toBe(false)
    expect(focused.classList.contains('glass-deep')).toBe(false)
    expect(focused.classList.contains('rounded-xl')).toBe(false)
    expect(focused.classList.contains('rounded-none')).toBe(false)
    expect(focused.classList.contains('inset-0')).toBe(false)
    // 深度类栈：聚焦 near / 失焦可见 middle；最大化与 ghost 不挂（另测）。
    expect(focused.classList.contains('sp-depth-near')).toBe(true)
    expect(focused.classList.contains('sp-depth-middle')).toBe(false)
    // 聚焦面档：更高面实度 + 中性细边 + 更深空间阴影（消费 --ag-window-face-
    // active / --sp-shadow-window-active，只提实度不加色相——active 禁止
    // 整体变蓝，不挂 primary 描边）。
    expect(focused.classList.contains('sp-win-focused')).toBe(true)
    expect(focused.classList.contains('sp-win-unfocused')).toBe(false)
    expect(focused.className).not.toContain('border-primary')
    // 悬停浮起只给失焦窗口（2026-10-10 已批准裁决 1）：聚焦窗口不挂。
    expect(focused.classList.contains('sp-win-hover')).toBe(false)

    const unfocused = screen.getByRole('region', { name: '记事' })
    expect(unfocused.classList.contains('sp-depth-middle')).toBe(true)
    expect(unfocused.classList.contains('sp-depth-near')).toBe(false)
    expect(unfocused.classList.contains('sp-win-unfocused')).toBe(true)
    expect(unfocused.classList.contains('sp-win-focused')).toBe(false)
    // 失焦 + 非最大化 + 非拖拽 → 悬停浮起类在场（translateY(-6px) scale(1.01)
    // 只发生在 :hover 态，静止布局盒不变——红线 10）。
    expect(unfocused.classList.contains('sp-win-hover')).toBe(true)
  })

  it('gates depth classes and hover lift behind the spatialMotion switch (关档直切)', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<WindowLayer />)

    const notes = () => screen.getByRole('region', { name: '记事' })
    const files = () => screen.getByRole('region', { name: '文件' })

    // 开档（默认）：深度类与悬停浮起类在栈上。
    expect(notes().classList.contains('sp-depth-middle')).toBe(true)
    expect(notes().classList.contains('sp-win-hover')).toBe(true)
    expect(notes().classList.contains('sp-motion-static')).toBe(false)

    // 关档：深度类与悬停浮起全部退场、挂 sp-motion-static 直切类；聚焦面档
    // 不受开关影响（材质恒在，动的只是变换与浮起）。
    act(() => {
      useMotionPrefsStore.setState({ spatialMotion: false })
    })
    expect(notes().classList.contains('sp-depth-middle')).toBe(false)
    expect(notes().classList.contains('sp-win-hover')).toBe(false)
    expect(notes().classList.contains('sp-motion-static')).toBe(true)
    expect(files().classList.contains('sp-depth-near')).toBe(false)
    expect(files().classList.contains('sp-motion-static')).toBe(true)
    expect(files().classList.contains('sp-win-focused')).toBe(true)

    // 重开：类栈随开关即时回位。
    act(() => {
      useMotionPrefsStore.setState({ spatialMotion: true })
    })
    expect(notes().classList.contains('sp-depth-middle')).toBe(true)
    expect(notes().classList.contains('sp-win-hover')).toBe(true)
    expect(notes().classList.contains('sp-motion-static')).toBe(false)
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

  it('title-bar drag never hijacks presses on portal dialogs (举报同意框, P4 §10)', () => {    // 复现口径（2026-10-03 E2E 实测）：羽化举报同意框 createPortal 到 body，其
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

  it('releases the flight effect on settle so the class stack owns transform/opacity', async () => {
    // fill: both 的已完结动画会把终帧压在级联之上（WAAPI 效果 > 作者样式），
    // 悬停浮起/失焦退后的 CSS 变换会被锁死——落定即 cancel 摘除效果。
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<WindowLayer />)

    expect(flights[0].cancel).not.toHaveBeenCalled() // 飞行期间效果必须在场
    await act(async () => {
      flights[0].resolve() // 打开飞行落定
    })
    expect(flights[0].cancel).toHaveBeenCalledTimes(1)
    expect((getRegion('记事') as HTMLElement).style.transform).toBe('') // 内联位姿照常清空
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
    // 空间化（2026-10-10）：ghost 是关闭退场快照——无深度类、无悬停浮起
    //（快照即使来自聚焦窗口也不挂 sp-depth-near）。
    expect(ghost?.className).not.toContain('sp-depth')
    expect(ghost?.className).not.toContain('sp-win-hover')

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

/**
 * W4 Window Snap 组合层转换点（审计 .tmp/spaces-audit.md §7 钉死裁决）：
 * resize 脱 snap 转换点=onResizePointerDown（先经 store unsnap、再从
 * getState() 读还原几何作基线）；标题栏 pointerdown 同理；pointerup 才做
 * 缘意图吸附（本次拖拽曾移动且命中判定带）。jsdom stub 1024×768：
 * band={left:80,top:32,width:944,height:736}，edge=max(12,round(944*.02))=19
 * → 左缘 x≤99 / 右缘 x≥1005 / 顶缘 y≤51；半屏宽 472。
 */
describe('WindowFrame × Window Snap（W4 组合层转换点）', () => {
  const BAND = { left: 80, top: 32, width: 944, height: 736 }
  const HALF = 472
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
    // jsdom 无 pointer capture API（既有 resize 手柄 handler 对此 try-catch
    // 兜底；标题栏 handler 无兜底且既有测试从不触发）。照 portal 测试先例
    // 补探针实现，聚焦本 describe 的 snap 转换逻辑而非 capture。
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true })
    delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture
    delete (HTMLElement.prototype as { releasePointerCapture?: unknown }).releasePointerCapture
  })

  const openWindow = (overrides: Record<string, unknown> = {}) =>
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', ...overrides })

  const headerOf = (title: string) => {
    const region = screen.getByRole('region', { name: title })
    return region.querySelector('header') as HTMLElement
  }

  it('拖到右缘 pointerup → 吸附右半屏（band 坐标，右缘贴齐）', () => {
    openWindow({ x: 300, y: 300 })
    render(<WindowLayer />)
    const header = headerOf('记事')

    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 50 })
    fireEvent.pointerMove(header, { clientX: 1010, clientY: 400 })
    fireEvent.pointerUp(header, { clientX: 1010, clientY: 400 })

    const win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('snapped')
    expect(win.snapMode).toBe('right')
    expect(win).toMatchObject({
      x: BAND.left + BAND.width - HALF,
      y: BAND.top,
      width: HALF,
      height: BAND.height,
    })
  })

  it('拖到左缘 pointerup → 吸附左半屏', () => {
    openWindow({ x: 300, y: 300 })
    render(<WindowLayer />)
    const header = headerOf('记事')

    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(header, { clientX: 90, clientY: 400 })
    fireEvent.pointerUp(header, { clientX: 90, clientY: 400 })

    const win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('snapped')
    expect(win.snapMode).toBe('left')
    expect(win).toMatchObject({ x: BAND.left, y: BAND.top, width: HALF, height: BAND.height })
  })

  it('拖到顶缘判定带 pointerup → 最大化（复用整视口真全屏语义）', () => {
    openWindow({ x: 300, y: 300 })
    render(<WindowLayer />)
    const header = headerOf('记事')

    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(header, { clientX: 500, clientY: 40 })
    fireEvent.pointerUp(header, { clientX: 500, clientY: 40 })

    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')
  })

  it('带外放手（拖到中间）→ 保持 normal 拖拽后几何，不吸附', () => {
    openWindow({ x: 300, y: 300 })
    render(<WindowLayer />)
    const header = headerOf('记事')

    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(header, { clientX: 530, clientY: 420 })
    fireEvent.pointerUp(header, { clientX: 530, clientY: 420 })

    const win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('normal')
    expect(win.snapMode).toBeNull()
  })

  it('点击标题栏未移动 → 不触发 snap/最大化（moved 前置条件）', () => {
    openWindow({ x: 500, y: 400 })
    render(<WindowLayer />)
    const header = headerOf('记事')

    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 400 })
    fireEvent.pointerUp(header, { clientX: 500, clientY: 400 })

    const win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('normal')
    expect(win).toMatchObject({ x: 500, y: 400 })
  })

  it('snapped 窗标题栏按下即脱 snap，拖动以还原几何为基线（指针零跳变）', () => {
    const id = openWindow({ x: 100, y: 100, width: 600, height: 400 })
    useWindowStore.getState().snap(id, 'left', BAND)
    render(<WindowLayer />)
    const header = headerOf('记事')
    expect(useWindowStore.getState().windows[0]?.state).toBe('snapped')

    // 按下瞬间：unsnap 完成、几何已还原。
    fireEvent.pointerDown(header, { button: 0, clientX: 200, clientY: 50 })
    let win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('normal')
    expect(win).toMatchObject({ x: 100, y: 100, width: 600, height: 400 })

    // 位移 +30/+20：以还原几何为基线 → x=130（若以 snapped 几何为基线会是 110）。
    fireEvent.pointerMove(header, { clientX: 230, clientY: 70 })
    win = useWindowStore.getState().windows[0]!
    expect(win).toMatchObject({ x: 130, y: 120, width: 600, height: 400 })

    // 带外放手：保持 normal。
    fireEvent.pointerUp(header, { clientX: 230, clientY: 70 })
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
  })

  it('snapped 窗按住拖到缘 pointerup → 重新吸附（先脱 snap 后 snap 的完整链）', () => {
    const id = openWindow({ x: 100, y: 100, width: 600, height: 400 })
    useWindowStore.getState().snap(id, 'left', BAND)
    render(<WindowLayer />)
    const header = headerOf('记事')

    fireEvent.pointerDown(header, { button: 0, clientX: 200, clientY: 50 })
    fireEvent.pointerMove(header, { clientX: 1010, clientY: 400 })
    fireEvent.pointerUp(header, { clientX: 1010, clientY: 400 })

    const win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('snapped')
    expect(win.snapMode).toBe('right')
    expect(win).toMatchObject({ x: BAND.left + BAND.width - HALF, width: HALF })
  })

  it('snapped 窗按下 resize 手柄 → 先经 store unsnap、以还原几何为 resizeOrigin 基线（评审遗留裁决）', () => {
    const id = openWindow({ x: 100, y: 100, width: 600, height: 400 })
    useWindowStore.getState().snap(id, 'left', BAND)
    render(<WindowLayer />)
    const se = screen.getByTestId('window-resize-se')

    // snapped 窗的 resize 手柄在场（!maximized 分支），按下即脱 snap。
    fireEvent.pointerDown(se, { button: 0, clientX: 552, clientY: 768 })
    let win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('normal')
    expect(win).toMatchObject({ x: 100, y: 100, width: 600, height: 400 })

    // 位移 +40/+40：以还原几何为基线 → 640×440（若以 snapped 几何 472 为基线会是 512）。
    fireEvent.pointerMove(se, { clientX: 592, clientY: 808 })
    win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('normal')
    expect(win.width).toBe(640)
    expect(win.height).toBe(440)

    fireEvent.pointerUp(se)
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
  })
})
