import { describe, it, expect } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'

import {
  WindowManager,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
} from './window-manager'
import { DEFAULT_SPACE_ID } from './space-types'

const VIEWPORT = { width: 1920, height: 1040 }

function createManager(events?: (keyof SystemEventMap)[]) {
  const bus = new EventBus<SystemEventMap>()
  const seen: string[] = []
  if (events) {
    for (const name of events) {
      bus.on(name, () => seen.push(name))
    }
  }
  let counter = 0
  const manager = new WindowManager(bus, () => `win-${++counter}`)
  return { manager, bus, seen, stateOf: (id: string) => manager.get(id)! }
}

describe('WindowManager.create', () => {
  it('applies defaults from the PRD window model', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'notes', title: 'Notes' })

    expect(win.id).toBe('win-1')
    expect(win.width).toBe(DEFAULT_WINDOW_WIDTH)
    expect(win.height).toBe(DEFAULT_WINDOW_HEIGHT)
    expect(win.state).toBe('normal')
    expect(win.focused).toBe(true)
    expect(win.zIndex).toBe(1)
    expect(win.resizable).toBe(true)
    expect(win.closable).toBe(true)
    expect(win.minWidth).toBe(MIN_WINDOW_WIDTH)
    expect(win.minHeight).toBe(MIN_WINDOW_HEIGHT)
    expect(win.restoreBounds).toBeNull()
  })

  it('unfocuses the previously focused window', () => {
    const { manager, stateOf } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })

    expect(stateOf(first.id).focused).toBe(false)
    expect(stateOf(second.id).focused).toBe(true)
    expect(stateOf(second.id).zIndex).toBeGreaterThan(stateOf(first.id).zIndex)
  })

  it('cascades default positions so windows do not overlap exactly', () => {
    const { manager } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })

    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('honors explicit geometry and enforces minimum size', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({
      appId: 'a',
      title: 'A',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })

    expect(win.x).toBe(10)
    expect(win.y).toBe(20)
    expect(stateOf(win.id).width).toBe(MIN_WINDOW_WIDTH)
    expect(stateOf(win.id).height).toBe(MIN_WINDOW_HEIGHT)
  })

  it('emits window.created followed by window.focused', () => {
    const { manager, seen } = createManager(['window.created', 'window.focused'])

    manager.create({ appId: 'a', title: 'A' })

    expect(seen).toEqual(['window.created', 'window.focused'])
  })

  it('assigns DEFAULT_SPACE_ID when no spaceId is given（W2 审计 §5：引擎纯兜底）', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })

    expect(win.spaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('honors an explicit spaceId（store 层 provider 注入后的透传路径）', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', spaceId: 'space-work' })

    expect(win.spaceId).toBe('space-work')
  })
})

describe('WindowManager.focus', () => {
  it('raises the focused window above all others', () => {
    const { manager, stateOf } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.focus(first.id)

    expect(stateOf(first.id).focused).toBe(true)
    expect(stateOf(second.id).focused).toBe(false)
    expect(stateOf(first.id).zIndex).toBeGreaterThan(stateOf(second.id).zIndex)
  })

  it('emits window.focused', () => {
    const { manager, seen } = createManager(['window.focused'])

    const win = manager.create({ appId: 'a', title: 'A' })
    seen.length = 0
    manager.focus(win.id)

    expect(seen).toEqual(['window.focused'])
  })

  it('refuses to focus unknown or minimized windows', () => {
    const { manager, seen } = createManager(['window.focused'])

    expect(manager.focus('missing')).toBe(false)

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    expect(manager.focus(win.id)).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('WindowManager.minimize', () => {
  it('marks the window minimized and unfocused', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('minimized')
    expect(state.focused).toBe(false)
    expect(manager.visibleList()).toHaveLength(0)
  })

  it('focuses the topmost remaining visible window', () => {
    const { manager } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.focus(second.id)

    manager.minimize(second.id)

    expect(manager.get(first.id)?.focused).toBe(true)
  })

  it('emits window.minimized and the refocus event', () => {
    const { manager, seen } = createManager(['window.minimized', 'window.focused'])

    manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    seen.length = 0

    manager.minimize(second.id)

    expect(seen).toEqual(['window.minimized', 'window.focused'])
  })

  it('is a no-op when already minimized', () => {
    const { manager, seen } = createManager(['window.minimized'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    expect(manager.minimize(win.id)).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('WindowManager.maximize', () => {
  it('stores restore bounds and switches state', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20 })
    manager.maximize(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('maximized')
    expect(state.restoreBounds).toEqual({
      x: 10,
      y: 20,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    })
    expect(state.focused).toBe(true)
  })

  it('emits window.maximized once and ignores repeats', () => {
    const { manager, seen } = createManager(['window.maximized'])

    const win = manager.create({ appId: 'a', title: 'A' })
    seen.length = 0

    expect(manager.maximize(win.id)).toBe(true)
    expect(manager.maximize(win.id)).toBe(false)
    expect(seen).toEqual(['window.maximized'])
  })

  it('maximizes a minimized window without overwriting restore bounds', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20 })
    manager.maximize(win.id)
    manager.minimize(win.id)
    manager.maximize(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('maximized')
    expect(state.restoreBounds).toEqual({
      x: 10,
      y: 20,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    })
  })
})

describe('WindowManager.restore', () => {
  it('returns a maximized window to its previous geometry', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20, width: 500, height: 400 })
    manager.maximize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('normal')
    expect(state.x).toBe(10)
    expect(state.y).toBe(20)
    expect(state.width).toBe(500)
    expect(state.height).toBe(400)
    expect(state.restoreBounds).toBeNull()
    expect(state.focused).toBe(true)
  })

  it('brings a minimized window back as maximized when it was maximized before', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.maximize(win.id)
    manager.minimize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('maximized')
    expect(state.focused).toBe(true)
  })

  it('brings a minimized normal window back as normal', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('normal')
    expect(state.restoreBounds).toBeNull()
  })

  it('emits window.restored', () => {
    const { manager, seen } = createManager(['window.restored'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    manager.restore(win.id)

    expect(seen).toEqual(['window.restored'])
  })

  it('is a no-op for a normal window', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })

    expect(manager.restore(win.id)).toBe(false)
  })
})

describe('WindowManager.snap / unsnap / 转换矩阵（W4，审计 .tmp/spaces-audit.md §7）', () => {
  const BAND = { left: 80, top: 32, width: 1000, height: 768 }
  const HALF = 500

  /** 每格断言终态五元组（state/geometry/restoreBounds/restoreState/snapMode，子集匹配）。 */
  function expectState(
    win: ReturnType<WindowManager['get']>,
    expected: {
      state?: string
      x?: number
      y?: number
      width?: number
      height?: number
      restoreBounds?: unknown
      restoreState?: string
      snapMode?: string | null
    },
  ) {
    expect(win).toMatchObject(expected)
  }

  it('normal→snapped：snap() 记 restoreBounds/restoreState、几何=半屏、广播 window.snapped', () => {
    const { manager, seen, stateOf } = createManager(['window.snapped'])

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    seen.length = 0

    expect(manager.snap(win.id, 'left', BAND)).toBe(true)

    expectState(stateOf(win.id), {
      state: 'snapped',
      x: BAND.left,
      y: BAND.top,
      width: HALF,
      height: BAND.height,
      restoreBounds: { x: 100, y: 100, width: 600, height: 400 },
      restoreState: 'normal',
      snapMode: 'left',
    })
    expect(seen).toEqual(['window.snapped'])

    // 右半对称：右缘贴齐 band 右缘。
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.snap(second.id, 'right', BAND)
    const right = stateOf(second.id)
    expect(right.snapMode).toBe('right')
    expect(right.x).toBe(BAND.left + BAND.width - HALF)
    expect(right.x + right.width).toBe(BAND.left + BAND.width)
  })

  it('normal→maximized（既有回归格）：restoreState 记 normal', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20 })
    manager.maximize(win.id)

    expectState(stateOf(win.id), {
      state: 'maximized',
      restoreBounds: { x: 10, y: 20, width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
      restoreState: 'normal',
      snapMode: null,
    })
  })

  it('normal→minimized（既有回归格）：restoreState 记 normal', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)

    expectState(stateOf(win.id), {
      state: 'minimized',
      restoreBounds: null,
      restoreState: 'normal',
      snapMode: null,
    })
  })

  it('snapped→normal：unsnap() 几何回 restoreBounds、清三字段、广播 window.unsnapped', () => {
    const { manager, seen, stateOf } = createManager(['window.unsnapped'])

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    manager.snap(win.id, 'right', BAND)
    seen.length = 0

    expect(manager.unsnap(win.id)).toBe(true)

    expectState(stateOf(win.id), {
      state: 'normal',
      x: 100,
      y: 100,
      width: 600,
      height: 400,
      restoreBounds: null,
      restoreState: 'normal',
      snapMode: null,
    })
    expect(seen).toEqual(['window.unsnapped'])
  })

  it('snapped→maximized：restoreState 记 snapped、snapped 几何原地保留、restoreBounds 保持原 normal 几何', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    manager.snap(win.id, 'left', BAND)
    manager.maximize(win.id)

    const state = stateOf(win.id)
    expectState(state, {
      state: 'maximized',
      x: BAND.left, // snapped 几何原地保留（maximized 渲染走 inset-0 不读 x/y）
      y: BAND.top,
      width: HALF,
      height: BAND.height,
      restoreBounds: { x: 100, y: 100, width: 600, height: 400 },
      restoreState: 'snapped',
      snapMode: 'left',
    })

    // restore() 按 restoreState='snapped' 分派：落回 snapped 原几何。
    manager.restore(win.id)
    expectState(stateOf(win.id), {
      state: 'snapped',
      x: BAND.left,
      y: BAND.top,
      width: HALF,
      height: BAND.height,
      restoreBounds: { x: 100, y: 100, width: 600, height: 400 },
      restoreState: 'normal',
      snapMode: 'left',
    })
  })

  it('snapped→minimized：restoreState 记 snapped；restore() 分派回 snapped 原几何', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    manager.snap(win.id, 'left', BAND)
    manager.minimize(win.id)

    expectState(stateOf(win.id), {
      state: 'minimized',
      restoreState: 'snapped',
      snapMode: 'left',
      restoreBounds: { x: 100, y: 100, width: 600, height: 400 },
    })

    manager.restore(win.id)
    expectState(stateOf(win.id), {
      state: 'snapped',
      x: BAND.left,
      y: BAND.top,
      width: HALF,
      height: BAND.height,
      restoreState: 'normal',
      snapMode: 'left',
    })
  })

  it('snapped→resize：引擎层 resize(snapped)=false 钉扎（转换在组合层 onResizePointerDown）', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    manager.snap(win.id, 'left', BAND)

    expect(manager.resize(win.id, 700, 500)).toBe(false)
    expectState(stateOf(win.id), {
      state: 'snapped',
      width: HALF,
      height: BAND.height,
      snapMode: 'left',
    })
  })

  it('snapped→move：引擎层 move(snapped)=false 钉扎（拖出由组合层先 unsnap）', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.snap(win.id, 'left', BAND)

    expect(manager.move(win.id, 200, 200, { width: 1920, height: 1040 })).toBe(false)
    expect(stateOf(win.id).x).toBe(BAND.left)
  })

  it('maximized→normal（既有回归格）：restoreBounds 回落、restoreState 归位', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 10, y: 20, width: 500, height: 400 })
    manager.maximize(win.id)
    manager.restore(win.id)

    expectState(stateOf(win.id), {
      state: 'normal',
      x: 10,
      y: 20,
      width: 500,
      height: 400,
      restoreBounds: null,
      restoreState: 'normal',
      snapMode: null,
    })
  })

  it('maximized→snapped：禁——snap() 拒绝（先还原），状态与事件零变化', () => {
    const { manager, seen, stateOf } = createManager(['window.snapped'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.maximize(win.id)
    seen.length = 0

    expect(manager.snap(win.id, 'left', BAND)).toBe(false)
    expect(stateOf(win.id).state).toBe('maximized')
    expect(seen).toEqual([])
  })

  it('maximized→minimized：restoreState 记 maximized；restore() 分派回 maximized（既有行为等价）', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.maximize(win.id)
    manager.minimize(win.id)

    expect(stateOf(win.id).restoreState).toBe('maximized')

    manager.restore(win.id)
    expect(stateOf(win.id).state).toBe('maximized')
    // 再次 restore 走 maximized 分支：restoreBounds 回落 normal。
    manager.restore(win.id)
    expectState(stateOf(win.id), {
      state: 'normal',
      restoreBounds: null,
      restoreState: 'normal',
    })
  })

  it('minimized→normal：restoreState=normal 分派（既有行为：restoreBounds 为 null 的最小化窗）', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    manager.restore(win.id)

    expectState(stateOf(win.id), {
      state: 'normal',
      restoreBounds: null,
      restoreState: 'normal',
      snapMode: null,
    })
  })

  it('minimized→snapped：restoreState=snapped 分派（restore 落回吸附原几何）', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    manager.snap(win.id, 'right', BAND)
    manager.minimize(win.id)
    manager.restore(win.id)

    expectState(stateOf(win.id), {
      state: 'snapped',
      x: BAND.left + BAND.width - HALF,
      y: BAND.top,
      width: HALF,
      height: BAND.height,
      restoreState: 'normal',
      snapMode: 'right',
    })
  })

  it('minimized→maximized：restoreState=maximized 分派（既有回归格等价）', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.maximize(win.id)
    manager.minimize(win.id)
    manager.restore(win.id)

    expect(stateOf(win.id).state).toBe('maximized')
  })

  it('snapped 重吸附须先 unsnap：snap(snapped)=false', () => {
    const { manager, seen, stateOf } = createManager(['window.snapped'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.snap(win.id, 'left', BAND)
    seen.length = 0

    expect(manager.snap(win.id, 'right', BAND)).toBe(false)
    expect(stateOf(win.id).snapMode).toBe('left')
    expect(seen).toEqual([])
  })

  it('unsnap 对 normal/maximized/minimized 均拒绝且不广播', () => {
    const { manager, seen, stateOf } = createManager(['window.unsnapped'])

    const win = manager.create({ appId: 'a', title: 'A' })
    expect(manager.unsnap(win.id)).toBe(false)
    manager.maximize(win.id)
    expect(manager.unsnap(win.id)).toBe(false)
    manager.restore(win.id)
    manager.minimize(win.id)
    expect(manager.unsnap(win.id)).toBe(false)
    expect(stateOf(win.id).state).toBe('minimized')
    expect(seen).toEqual([])
  })

  it('快速序列 snap→unsnap→snap→maximize→restore→minimize→restore 无状态卡死', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100, width: 600, height: 400 })
    manager.snap(win.id, 'left', BAND)
    manager.unsnap(win.id)
    manager.snap(win.id, 'right', BAND)
    manager.maximize(win.id)
    manager.restore(win.id)
    manager.minimize(win.id)
    manager.restore(win.id)

    const state = stateOf(win.id)
    expect(state.state).toBe('snapped')
    expect(state.snapMode).toBe('right')
    expect(state.restoreState).toBe('normal')
    expect(state.restoreBounds).toEqual({ x: 100, y: 100, width: 600, height: 400 })

    // 终态后仍可正常脱 snap 回最初几何。
    manager.unsnap(win.id)
    expectState(stateOf(win.id), {
      state: 'normal',
      x: 100,
      y: 100,
      width: 600,
      height: 400,
      snapMode: null,
      restoreBounds: null,
    })
  })

  it('snap 对 minimized / 未知窗口拒绝且不广播', () => {
    const { manager, seen, stateOf } = createManager(['window.snapped'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.minimize(win.id)
    seen.length = 0

    expect(manager.snap(win.id, 'left', BAND)).toBe(false)
    expect(manager.snap('missing', 'left', BAND)).toBe(false)
    expect(stateOf(win.id).state).toBe('minimized')
    expect(seen).toEqual([])
  })
})

describe('WindowManager.close', () => {
  it('removes the window and focuses the next topmost visible one', () => {
    const { manager, seen } = createManager(['window.closed', 'window.focused'])

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    seen.length = 0

    expect(manager.close(second.id)).toBe(true)

    expect(manager.get(second.id)).toBeNull()
    expect(manager.count).toBe(1)
    expect(seen).toEqual(['window.closed', 'window.focused'])
    expect(manager.get(first.id)?.focused).toBe(true)
  })

  it('returns false for unknown ids', () => {
    const { manager, seen } = createManager(['window.closed'])

    expect(manager.close('missing')).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('WindowManager 跨 Space 焦点补位（B2 审查）', () => {
  it('关闭聚焦窗只在同 Space 内补位，不把焦点给其他 Space 的窗口', () => {
    const { manager } = createManager()
    const a1 = manager.create({ appId: 'a', title: 'A1', spaceId: 'space-a' })
    const a2 = manager.create({ appId: 'a', title: 'A2', spaceId: 'space-a' })
    const b1 = manager.create({ appId: 'b', title: 'B1', spaceId: 'space-b' })
    manager.focus(a2.id)

    manager.close(a2.id)

    expect(manager.get(a1.id)?.focused).toBe(true)
    expect(manager.get(b1.id)?.focused).toBe(false)
  })

  it('最小化聚焦窗只在同 Space 内补位', () => {
    const { manager } = createManager()
    const a1 = manager.create({ appId: 'a', title: 'A1', spaceId: 'space-a' })
    const a2 = manager.create({ appId: 'a', title: 'A2', spaceId: 'space-a' })
    const b1 = manager.create({ appId: 'b', title: 'B1', spaceId: 'space-b' })
    manager.focus(a2.id)

    manager.minimize(a2.id)

    expect(manager.get(a1.id)?.focused).toBe(true)
    expect(manager.get(b1.id)?.focused).toBe(false)
  })

  it('关闭其他 Space 的后台窗口不动当前焦点', () => {
    const { manager } = createManager()
    const a1 = manager.create({ appId: 'a', title: 'A1', spaceId: 'space-a' })
    const b1 = manager.create({ appId: 'b', title: 'B1', spaceId: 'space-b' })
    expect(manager.get(b1.id)?.focused).toBe(true)

    manager.close(a1.id)

    expect(manager.get(b1.id)?.focused).toBe(true)
  })
})

describe('WindowManager.move', () => {
  it('moves a normal window freely without a viewport', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.move(win.id, -500, -10)

    const state = stateOf(win.id)
    expect(state.x).toBe(-500)
    expect(state.y).toBe(0)
  })

  it('clamps so the window keeps a visible edge inside the viewport', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })

    manager.move(win.id, -99999, -99999, VIEWPORT)
    expect(stateOf(win.id).x).toBe(80 - DEFAULT_WINDOW_WIDTH)
    expect(stateOf(win.id).y).toBe(0)

    manager.move(win.id, 99999, 99999, VIEWPORT)
    expect(stateOf(win.id).x).toBe(VIEWPORT.width - 80)
    expect(stateOf(win.id).y).toBe(VIEWPORT.height - 80)
  })

  it('rejects moving maximized or minimized windows', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 50, y: 50 })
    manager.maximize(win.id)

    expect(manager.move(win.id, 100, 100, VIEWPORT)).toBe(false)
    expect(stateOf(win.id).x).toBe(50)
  })
})

describe('WindowManager.resize', () => {
  it('resizes a normal window within viewport bounds', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100 })

    expect(manager.resize(win.id, 700, 500, VIEWPORT)).toBe(true)
    expect(stateOf(win.id).width).toBe(700)
    expect(stateOf(win.id).height).toBe(500)
  })

  it('enforces the configured minimum size', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', minWidth: 400, minHeight: 300 })

    manager.resize(win.id, 10, 10)

    expect(stateOf(win.id).width).toBe(400)
    expect(stateOf(win.id).height).toBe(300)
  })

  it('caps the window at the viewport edge it grew towards', () => {
    const { manager, stateOf } = createManager()

    const win = manager.create({ appId: 'a', title: 'A', x: 100, y: 100 })

    manager.resize(win.id, 99999, 99999, VIEWPORT)

    expect(stateOf(win.id).width).toBe(VIEWPORT.width - 100)
    expect(stateOf(win.id).height).toBe(VIEWPORT.height - 100)
  })

  it('rejects non-resizable or non-normal windows', () => {
    const { manager, stateOf } = createManager()

    const fixed = manager.create({ appId: 'a', title: 'A', resizable: false })
    expect(manager.resize(fixed.id, 800, 600)).toBe(false)
    expect(stateOf(fixed.id).width).toBe(DEFAULT_WINDOW_WIDTH)

    const win = manager.create({ appId: 'b', title: 'B' })
    manager.minimize(win.id)
    expect(manager.resize(win.id, 800, 600)).toBe(false)
  })
})

describe('WindowManager.moveWindowToSpace（W2，审计 §5 决定 3）', () => {
  it('reassigns the window, keeps zIndex/focused untouched, and emits window.space-assigned', () => {
    const { manager, seen, stateOf } = createManager(['window.space-assigned'])

    const win = manager.create({ appId: 'a', title: 'A' })
    manager.create({ appId: 'b', title: 'B' }) // 保证 A 非 focused，观察焦点是否被动
    const zIndexBefore = stateOf(win.id).zIndex
    seen.length = 0

    expect(manager.moveWindowToSpace(win.id, 'space-work')).toBe(true)

    const state = stateOf(win.id)
    expect(state.spaceId).toBe('space-work')
    expect(state.zIndex).toBe(zIndexBefore)
    expect(state.focused).toBe(false)
    expect(seen).toEqual(['window.space-assigned'])
  })

  it('carries { windowId, fromSpaceId, toSpaceId } in the payload', () => {
    const { manager, bus } = createManager()
    const payloads: unknown[] = []
    bus.on('window.space-assigned', (payload) => payloads.push(payload))

    const win = manager.create({ appId: 'a', title: 'A', spaceId: 'space-one' })
    manager.moveWindowToSpace(win.id, 'space-two')

    expect(payloads).toEqual([
      { windowId: win.id, fromSpaceId: 'space-one', toSpaceId: 'space-two' },
    ])
  })

  it('rejects an empty spaceId without emitting', () => {
    const { manager, seen } = createManager(['window.space-assigned'])

    const win = manager.create({ appId: 'a', title: 'A' })
    seen.length = 0

    expect(manager.moveWindowToSpace(win.id, '')).toBe(false)
    expect(seen).toEqual([])
  })

  it('rejects unknown windows and same-space no-ops without emitting', () => {
    const { manager, seen } = createManager(['window.space-assigned'])

    const win = manager.create({ appId: 'a', title: 'A' })
    seen.length = 0

    expect(manager.moveWindowToSpace('missing', 'space-work')).toBe(false)
    expect(manager.moveWindowToSpace(win.id, DEFAULT_SPACE_ID)).toBe(false)
    expect(seen).toEqual([])
  })

  it('hydrateWindows ingests persisted windows, forces focused=false, and keeps topZ monotonic', () => {
    const { manager, stateOf } = createManager()

    manager.hydrateWindows([
      {
        id: 'win-1',
        appId: 'a',
        title: 'A',
        x: 10,
        y: 20,
        width: 400,
        height: 300,
        zIndex: 41,
        state: 'normal',
        focused: true, // 恢复时一律落 false（焦点由 store 层对 active Space 栈顶补）
        resizable: true,
        closable: true,
        minWidth: 320,
        minHeight: 200,
        restoreBounds: null,
        snapMode: null,
        restoreState: 'normal',
        spaceId: 'space-work',
      },
    ])
    expect(stateOf('win-1').focused).toBe(false)
    expect(stateOf('win-1').spaceId).toBe('space-work')

    // 新开窗口 z 必须高于恢复的最大 z（topZ 重置为 max(zIndex)）。
    const fresh = manager.create({ appId: 'b', title: 'B' })
    expect(stateOf(fresh.id).zIndex).toBeGreaterThan(41)
  })
})

describe('WindowManager snapshots', () => {
  it('returns copies so callers cannot mutate internal state', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: 'A' })
    win.title = 'mutated'
    win.state = 'minimized'

    expect(manager.get(win.id)?.title).toBe('A')
    expect(manager.get(win.id)?.state).toBe('normal')
  })

  it('lists windows in z-order', () => {
    const { manager } = createManager()

    const first = manager.create({ appId: 'a', title: 'A' })
    const second = manager.create({ appId: 'b', title: 'B' })
    manager.focus(first.id)

    expect(manager.list().map((w) => w.id)).toEqual([second.id, first.id])
  })
})

describe('WindowManager.setTitle（SDK Window API 底座）', () => {
  it('updates the title of an existing window and rejects invalid titles', () => {
    const { manager } = createManager()

    const win = manager.create({ appId: 'a', title: '时钟' })
    expect(manager.setTitle(win.id, '便签 (3)')).toBe(true)
    expect(manager.get(win.id)?.title).toBe('便签 (3)')

    expect(manager.setTitle(win.id, '   ')).toBe(false)
    expect(manager.setTitle(win.id, 'x'.repeat(121))).toBe(false)
    expect(manager.setTitle('missing', '任何标题')).toBe(false)
    expect(manager.get(win.id)?.title).toBe('便签 (3)')
  })
})

describe('WindowManager 边界收紧（B2 审查）', () => {
  it('minimize→maximize→restore 不再永久停在 maximized', () => {
    const { manager, stateOf } = createManager()
    const win = manager.create({ appId: 'a', title: 'A', x: 40, y: 60, width: 500, height: 400 })
    manager.minimize(win.id)
    manager.maximize(win.id)
    expect(stateOf(win.id).state).toBe('maximized')
    manager.restore(win.id)
    // maximize 时按当时几何补记 restoreBounds；restore 消费后落回原几何。
    expect(stateOf(win.id).state).toBe('normal')
    expect(stateOf(win.id)).toMatchObject({ x: 40, y: 60, width: 500, height: 400 })
    expect(stateOf(win.id).restoreBounds).toBeNull()
  })

  it('固定尺寸窗口按声明落（计算器 300px 不被默认 320 下限抬高）', () => {
    const { manager, stateOf } = createManager()
    const win = manager.create({ appId: 'calc', title: 'C', width: 300, height: 440, resizable: false })
    expect(stateOf(win.id).width).toBe(300)
    expect(stateOf(win.id).resizable).toBe(false)
  })

  it('viewport 剩余空间不足时 resize 落最小尺寸（不再击穿下限）', () => {
    const { manager, stateOf } = createManager()
    const win = manager.create({ appId: 'a', title: 'A', x: 1880, y: 0, width: 400, height: 300 })
    manager.resize(win.id, 400, 300, VIEWPORT)
    // 右缘剩余 40px < minWidth：落最小宽；高度剩余充足照常。
    expect(stateOf(win.id).width).toBe(MIN_WINDOW_WIDTH)
    expect(stateOf(win.id).height).toBe(300)
  })

  it('generateId 撞现存 id 时重试；确定性坏生成器抛错', () => {
    const bus = new EventBus<SystemEventMap>()
    const manager = new WindowManager(bus, () => 'win-dup')
    manager.create({ appId: 'a', title: 'A' })
    // 重新建实例：同一生成器但空表 → 首个 id 正常落。
    const manager2 = new WindowManager(bus, () => 'win-dup')
    manager2.create({ appId: 'a', title: 'A' })
    expect(() => manager2.create({ appId: 'a', title: 'B' })).toThrow(/duplicate id/)
  })
})
