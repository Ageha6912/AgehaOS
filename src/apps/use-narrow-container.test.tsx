import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_NARROW_BREAKPOINT, useNarrowContainer } from './use-narrow-container'

/**
 * 窄容器判定 hook（M2-5 引入、M2-6 提升为 src/apps 根共享模块）专项契约。
 * 组件级行为（侧栏收起 / 单面切换 / 触屏语义）归各应用 test 的窄容器组；
 * 这里钉 hook 本体四条：
 * ① 断点边界按内容盒宽判定（<560 narrow，≥560 wide）且随 resize 双向跟随；
 * ② 同档宽度重复观测不翻动状态（布尔等值 bail-out 路径）；
 * ③ 无 ResizeObserver 环境（vitest jsdom 原生状态）降级恒 wide——桌面兜底；
 * ④ 观测目标 = 挂 ref 的根元素本体，卸载断开观测。
 */

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observed: Element[] = []
  disconnected = false
  observe(target: Element): void {
    this.observed.push(target)
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true
  }
  /** 手动喂一次观测回调。真实 RO 在 observe 时必发初始帧，这里显式喂。 */
  emit(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

function Probe({ onRender }: { onRender?: () => void }): React.ReactElement {
  const { ref, narrow } = useNarrowContainer()
  onRender?.()
  return <div ref={ref} data-testid="narrow-probe" data-narrow={narrow ? 'true' : 'false'} />
}

describe('useNarrowContainer', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('断点边界：<560 narrow，=560 wide，双向跟随不粘连', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    const { getByTestId } = render(<Probe />)

    // 渲染后 effect 已建立观测，观测目标 = 挂 ref 的根元素本体。
    const observer = FakeResizeObserver.instances.at(-1)
    expect(observer).toBeDefined()
    const el = observer!.observed[0]
    expect(el).toBe(getByTestId('narrow-probe'))

    // 初始帧 880（桌面窗口档）：wide。
    act(() => observer!.emit(880))
    expect(getByTestId('narrow-probe').getAttribute('data-narrow')).toBe('false')

    // 收缩过断点（559 < 560）：narrow。
    act(() => observer!.emit(559))
    expect(getByTestId('narrow-probe').getAttribute('data-narrow')).toBe('true')

    // 断点本身（560 = APP_NARROW_BREAKPOINT）：不算窄（width < breakpoint）。
    act(() => observer!.emit(APP_NARROW_BREAKPOINT))
    expect(getByTestId('narrow-probe').getAttribute('data-narrow')).toBe('false')

    // 再缩回去：不粘连，双向跟随（窗口拖拽缩放往返）。
    act(() => observer!.emit(360))
    expect(getByTestId('narrow-probe').getAttribute('data-narrow')).toBe('true')
  })

  it('同一档宽度重复观测：布尔不变不重渲染（等值 bail-out）', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    let renders = 0
    render(<Probe onRender={() => void ++renders} />)

    const observer = FakeResizeObserver.instances.at(-1)
    expect(observer).toBeDefined()

    // 首次进入 narrow：状态翻动一次（mount 后首轮 false→true 重渲染）。
    act(() => observer!.emit(360))
    const rendersAfterFlip = renders
    expect(rendersAfterFlip).toBeGreaterThan(1)

    // 同档重复帧（拖拽缩放期间 RO 每帧回调）：updater 返回原值 → setState
    // bail-out——状态不翻动；React 的 bail-out 语义允许一次「牺牲性重渲染」
    // （React 文档：may still render that specific component before bailing
    // out），钉上界 ≤1 次，绝非每帧一次。
    act(() => observer!.emit(361))
    act(() => observer!.emit(370))
    expect(renders).toBeLessThanOrEqual(rendersAfterFlip + 1)
    expect(screen.getByTestId('narrow-probe').getAttribute('data-narrow')).toBe('true')
  })

  it('无 ResizeObserver 环境：降级恒 wide（桌面兜底，绝不抛错）', () => {
    // jsdom 原生无 ResizeObserver，本用例刻意不 stub——hook 必须安静降级，
    // 既有桌面用例（各应用 test 的其余组）即在此路径零改动通过。
    expect(typeof ResizeObserver).toBe('undefined')
    const { getByTestId, unmount } = render(<Probe />)
    expect(getByTestId('narrow-probe').getAttribute('data-narrow')).toBe('false')
    // 卸载不抛错（effect 提前返回，无 observer 可 disconnect）。
    expect(() => unmount()).not.toThrow()
  })

  it('卸载断开观测（ResizeObserver.disconnect）', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    const { unmount } = render(<Probe />)
    const observer = FakeResizeObserver.instances.at(-1)
    expect(observer).toBeDefined()
    expect(observer!.disconnected).toBe(false)
    unmount()
    expect(observer!.disconnected).toBe(true)
  })
})
