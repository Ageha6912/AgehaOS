import { beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'

import { DEFAULT_SPACE_ID, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@/core/window'
import { registerBuiltinApps, resetAppStore } from '@/store/app-store'
import { systemSounds } from '@/services/sounds'

import {
  WINDOWS_STORAGE_KEY,
  serializeWindows,
  type PersistedWindow,
} from './window-persist'
import {
  hydratePersistedWindows,
  resetWindowStore,
  setWindowSpaceExistsProvider,
  setWindowSpaceIdProvider,
  useWindowStore,
} from './window-store'

function resetProviders(): void {
  setWindowSpaceIdProvider(() => DEFAULT_SPACE_ID)
  setWindowSpaceExistsProvider(() => true)
}

beforeEach(() => {
  localStorage.removeItem(WINDOWS_STORAGE_KEY)
  resetWindowStore()
  resetProviders()
  // 镜像 boot（main.tsx:37）：hydrate 的「appId 无 manifest 丢弃」依赖注册表。
  resetAppStore()
  registerBuiltinApps()
})

describe('useWindowStore', () => {
  it('opens a window and syncs it into state', () => {
    const id = useWindowStore.getState().open({ appId: 'notes', title: 'Notes' })

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.id).toBe(id)
    expect(windows[0]?.focused).toBe(true)
  })

  it('closes a window and removes it from state', () => {
    const { open, close } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    close(id)

    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('toggles maximize and restore through toggleMaximize', () => {
    const { open, toggleMaximize } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes', x: 10, y: 10 })

    toggleMaximize(id)
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')

    toggleMaximize(id)
    const restored = useWindowStore.getState().windows[0]
    expect(restored?.state).toBe('normal')
    expect(restored?.x).toBe(10)
    expect(restored?.y).toBe(10)
  })

  it('delegates move with viewport clamping to the engine', () => {
    const { open, move } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    move(id, 99999, 99999, { width: 1920, height: 1040 })

    const win = useWindowStore.getState().windows[0]
    expect(win?.x).toBe(1920 - 80)
    expect(win?.y).toBe(1040 - 80)
  })

  it('keeps minimized windows mounted in state but out of the visible list', () => {
    const { open, minimize } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    minimize(id)

    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().windows[0]?.state).toBe('minimized')
    expect(useWindowStore.getState().windows[0]?.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(useWindowStore.getState().windows[0]?.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
  })
})

describe('useWindowStore × spaceId（W2，审计 §5 决定 1）', () => {
  it('open() 缺省走 provider 注入的当前 Space', () => {
    setWindowSpaceIdProvider(() => 'space-current')

    useWindowStore.getState().open({ appId: 'notes', title: 'Notes' })

    expect(useWindowStore.getState().windows[0]?.spaceId).toBe('space-current')
  })

  it('open() 显式 spaceId 透传（优先于 provider）', () => {
    setWindowSpaceIdProvider(() => 'space-current')

    useWindowStore.getState().open({ appId: 'notes', title: 'Notes', spaceId: 'space-explicit' })

    expect(useWindowStore.getState().windows[0]?.spaceId).toBe('space-explicit')
  })

  it('moveWindowToSpace 成功改派并同步 state', () => {
    const { open } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    useWindowStore.getState().moveWindowToSpace(id, 'space-work')

    expect(useWindowStore.getState().windows[0]?.spaceId).toBe('space-work')
    // 焦点与 zIndex 不动（跨 Space 不抢焦点）。
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })

  it('moveWindowToSpace 目标 Space 不存在 → no-op（经 provider 校验，不 import space-store）', () => {
    setWindowSpaceExistsProvider((spaceId) => spaceId === DEFAULT_SPACE_ID)
    const { open } = useWindowStore.getState()
    const id = open({ appId: 'notes', title: 'Notes' })

    useWindowStore.getState().moveWindowToSpace(id, 'space-ghost')

    expect(useWindowStore.getState().windows[0]?.spaceId).toBe(DEFAULT_SPACE_ID)
  })
})

describe('useWindowStore × 窗口持久化（W2，审计 §5 决定 2）', () => {
  function persistedEntry(overrides: Partial<PersistedWindow> = {}): PersistedWindow {
    return {
      id: 'win-1',
      appId: 'com.ageha.notes',
      title: '记事',
      x: 176,
      y: 176,
      width: 900,
      height: 600,
      state: 'normal',
      spaceId: DEFAULT_SPACE_ID,
      restoreBounds: null,
      zIndex: 3,
      ...overrides,
    }
  }

  it('preserves object identity for unchanged windows (E1 审查：memo 渲染层可按引用跳过)', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事一' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事二' })
    const before = useWindowStore.getState().windows
    const firstBefore = before.find((win) => win.id === first)
    const secondBefore = before.find((win) => win.id === second)

    useWindowStore.getState().move(second, 320, 240)

    const after = useWindowStore.getState().windows
    // 未变化的窗口复用旧引用；移动过的窗口换新引用。
    expect(after.find((win) => win.id === first)).toBe(firstBefore)
    expect(after.find((win) => win.id === second)).not.toBe(secondBefore)
  })

  it('每次 commit 后静默 persist（key agehaos.spaces.windows.v1）', () => {
    const { open, move } = useWindowStore.getState()
    const id = open({ appId: 'com.ageha.notes', title: '记事' })

    move(id, 300, 200)

    const persisted = JSON.parse(localStorage.getItem(WINDOWS_STORAGE_KEY)!) as {
      version: number
      windows: PersistedWindow[]
    }
    expect(persisted.version).toBe(1)
    expect(persisted.windows).toHaveLength(1)
    expect(persisted.windows[0]).toMatchObject({ id, x: 300, y: 200, appId: 'com.ageha.notes' })
    // 运行时字段不落盘。
    expect('focused' in persisted.windows[0]!).toBe(false)
  })

  it('round-trip：写盘 → reset → hydrate 恢复几何/状态/归属', () => {
    const { open, move, toggleMaximize, moveWindowToSpace } = useWindowStore.getState()
    const first = open({ appId: 'com.ageha.notes', title: '记事', x: 50, y: 60 })
    const second = open({ appId: 'com.ageha.files', title: '文件' })
    moveWindowToSpace(second, 'space-work')
    // move 仅 normal 态生效——先移动再最大化。
    move(first, 120, 80)
    toggleMaximize(first)

    const before = useWindowStore.getState().windows
    resetWindowStore()
    expect(useWindowStore.getState().windows).toHaveLength(0)

    hydratePersistedWindows()

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(2)
    const restoredFirst = windows.find((win) => win.id === first)!
    expect(restoredFirst).toMatchObject({ state: 'maximized', x: 120, y: 80 })
    expect(restoredFirst.restoreBounds).toEqual(before.find((win) => win.id === first)!.restoreBounds)
    expect(windows.find((win) => win.id === second)?.spaceId).toBe('space-work')
    // 恢复后焦点归 active Space（DEFAULT_SPACE_ID）栈顶；space-work 窗口不聚焦。
    expect(restoredFirst.focused).toBe(true)
    expect(windows.find((win) => win.id === second)?.focused).toBe(false)
  })

  it('clamps off-screen / undersized persisted geometry into the viewport (C1 审查)', () => {
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        persistedEntry({
          id: 'win-offscreen',
          x: 5000,
          y: 4000,
          width: 50,
          height: 10,
          restoreBounds: { x: -9000, y: 9000, width: 0, height: 0 },
        }),
      ]),
    )

    hydratePersistedWindows()

    const win = useWindowStore.getState().windows[0]
    expect(win).toBeDefined()
    // 脏尺寸抬到引擎最小值。
    expect(win!.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(win!.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
    // 至少 MIN_VISIBLE_EDGE 留在视口内（复用引擎的拖动钳制口径）。
    expect(win!.x).toBeLessThanOrEqual(window.innerWidth - 80)
    expect(win!.y).toBeLessThanOrEqual(window.innerHeight - 80)
    expect(win!.x).toBeGreaterThanOrEqual(80 - win!.width)
    expect(win!.y).toBeGreaterThanOrEqual(0)
    // restoreBounds 同样钳制，避免还原时再次飞出。
    expect(win!.restoreBounds?.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH)
    expect(win!.restoreBounds?.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT)
    expect(win!.restoreBounds?.y).toBeLessThanOrEqual(window.innerHeight - 80)
  })

  it('损坏持久化数据整体丢弃（回落空桌面）', () => {
    localStorage.setItem(WINDOWS_STORAGE_KEY, '{not json')
    hydratePersistedWindows()
    expect(useWindowStore.getState().windows).toHaveLength(0)

    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      JSON.stringify({ version: 99, windows: [] }),
    )
    hydratePersistedWindows()
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('appId 暂未注册（运行时应用）的窗口保留，不因启动顺序被丢弃', () => {
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        persistedEntry({ id: 'win-runtime', appId: 'com.ageha.eclosion.world.today' }),
        persistedEntry({ id: 'win-real', appId: 'com.ageha.notes', zIndex: 5 }),
      ]),
    )

    hydratePersistedWindows()

    const windows = useWindowStore.getState().windows
    expect(new Set(windows.map((win) => win.id))).toEqual(new Set(['win-runtime', 'win-real']))
    // 持久表不被“过滤后的子集”覆写——运行时应用稍后注册仍能恢复。
    const stored = JSON.parse(localStorage.getItem(WINDOWS_STORAGE_KEY) ?? '{}') as {
      windows: Array<{ id: string }>
    }
    expect(new Set(stored.windows.map((win) => win.id))).toEqual(
      new Set(['win-runtime', 'win-real']),
    )
  })

  it('spaceId 失联（不在当前 Space 列表）的窗口丢弃（防御）', () => {
    setWindowSpaceExistsProvider((spaceId) => spaceId === DEFAULT_SPACE_ID)
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        persistedEntry({ id: 'win-orphan', spaceId: 'space-deleted' }),
        persistedEntry({ id: 'win-kept', zIndex: 7 }),
      ]),
    )

    hydratePersistedWindows()

    expect(useWindowStore.getState().windows.map((win) => win.id)).toEqual(['win-kept'])
  })

  it('hydrate 焦点归 active Space 内 zIndex 最大者', () => {
    setWindowSpaceIdProvider(() => 'space-active')
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        persistedEntry({ id: 'win-low', spaceId: 'space-active', zIndex: 10 }),
        persistedEntry({ id: 'win-top', spaceId: 'space-active', zIndex: 20 }),
        persistedEntry({ id: 'win-other', spaceId: 'space-background', zIndex: 30 }),
      ]),
    )

    hydratePersistedWindows()

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === 'win-top')?.focused).toBe(true)
    expect(windows.find((win) => win.id === 'win-low')?.focused).toBe(false)
    expect(windows.find((win) => win.id === 'win-other')?.focused).toBe(false)
  })

  it('空 store 守卫：当前已有窗口时不灌入（Desktop 重挂不重复）', () => {
    const kept = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '在场窗口' })
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([persistedEntry({ id: 'win-from-disk', zIndex: 3 })]),
    )

    hydratePersistedWindows()

    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.id).toBe(kept)
  })

  it('无持久化数据时 hydrate 为 no-op', () => {
    hydratePersistedWindows()

    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(localStorage.getItem(WINDOWS_STORAGE_KEY)).toBeNull()
  })
})

describe('useWindowStore × Window Snap（W4，审计 .tmp/spaces-audit.md §7）', () => {
  const BAND = { left: 80, top: 32, width: 1000, height: 768 }

  it('snap/unsnap 透传引擎并同步 state（commit）', () => {
    const { open, snap, unsnap } = useWindowStore.getState()
    const id = open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100, width: 600, height: 400 })

    snap(id, 'left', BAND)

    let win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('snapped')
    expect(win.snapMode).toBe('left')
    expect(win).toMatchObject({ x: BAND.left, y: BAND.top, width: 500, height: BAND.height })
    // 每次 commit 后静默 persist：snapped 态已落盘。
    expect(JSON.parse(localStorage.getItem(WINDOWS_STORAGE_KEY)!).windows[0].state).toBe('snapped')

    unsnap(id)

    win = useWindowStore.getState().windows[0]!
    expect(win.state).toBe('normal')
    expect(win.snapMode).toBeNull()
    expect(win).toMatchObject({ x: 100, y: 100, width: 600, height: 400 })
  })

  it('吸附成功响一声软叩击；引擎拒绝（maximized）无声', () => {
    const play = vi.spyOn(systemSounds, 'play').mockImplementation(() => undefined)
    const { open, toggleMaximize, snap } = useWindowStore.getState()
    const id = open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100, width: 600, height: 400 })
    snap(id, 'left', BAND)
    expect(play).toHaveBeenCalledWith('snap')

    play.mockClear()
    const other = open({ appId: 'com.ageha.notes', title: '记事 2', x: 100, y: 100, width: 600, height: 400 })
    toggleMaximize(other)
    snap(other, 'left', BAND) // 引擎拒绝：状态未变 = 无声
    expect(play).not.toHaveBeenCalled()
  })

  it('非法调用（maximized snap / normal unsnap）no-op 不产生脏 commit', () => {
    const { open, toggleMaximize, snap, unsnap } = useWindowStore.getState()
    const id = open({ appId: 'com.ageha.notes', title: '记事' })

    toggleMaximize(id)
    snap(id, 'left', BAND)
    expect(useWindowStore.getState().windows[0]?.state).toBe('maximized')

    toggleMaximize(id)
    unsnap(id)
    expect(useWindowStore.getState().windows[0]?.state).toBe('normal')
  })

  it('snapped 窗 round-trip：state/snapMode/restoreBounds/restoreState 落盘并恢复', () => {
    const { open, snap } = useWindowStore.getState()
    const id = open({ appId: 'com.ageha.notes', title: '记事', x: 100, y: 100, width: 600, height: 400 })
    snap(id, 'right', BAND)

    resetWindowStore()
    hydratePersistedWindows()

    const restored = useWindowStore.getState().windows[0]!
    expect(restored.id).toBe(id)
    expect(restored.state).toBe('snapped')
    expect(restored.snapMode).toBe('right')
    expect(restored.restoreState).toBe('normal')
    expect(restored.restoreBounds).toEqual({ x: 100, y: 100, width: 600, height: 400 })
    // 手动还原行为正确（W4 验收：保留原几何，state/snapMode 还原）。
    useWindowStore.getState().unsnap(id)
    const unsnapped = useWindowStore.getState().windows[0]!
    expect(unsnapped.state).toBe('normal')
    expect(unsnapped).toMatchObject({ x: 100, y: 100, width: 600, height: 400 })
  })

  it('旧载荷缺 snap/restore 字段（W4 前向兼容）：snapMode=null、restoreState=normal，不清桌面', () => {
    // 手写 W2 时代载荷（无 snapMode/restoreState 键）。
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        windows: [
          {
            id: 'win-legacy',
            appId: 'com.ageha.notes',
            title: '记事',
            x: 10,
            y: 20,
            width: 400,
            height: 300,
            state: 'normal',
            spaceId: DEFAULT_SPACE_ID,
            restoreBounds: null,
            zIndex: 1,
          },
        ],
      }),
    )

    hydratePersistedWindows()

    const win = useWindowStore.getState().windows[0]!
    expect(win.id).toBe('win-legacy')
    expect(win.snapMode).toBeNull()
    expect(win.restoreState).toBe('normal')
  })
})

describe('useWindowStore × 应用卸载（B2 审查）', () => {
  it('app.uninstalled 关闭该应用全部窗口；hydrate 从 manifest 回读 resizable', () => {
    registerBuiltinApps()
    // 计算器 manifest：window.resizable=false。
    const calcId = useWindowStore.getState().open({
      appId: 'com.ageha.calculator',
      title: '计算器',
      width: 300,
      height: 440,
      resizable: false,
    })
    expect(useWindowStore.getState().windows.find((win) => win.id === calcId)?.resizable).toBe(false)

    systemBus.emit('app.uninstalled', { appId: 'com.ageha.calculator' })
    expect(useWindowStore.getState().windows.find((win) => win.id === calcId)).toBeUndefined()
  })

  it('hydrate：固定尺寸应用的 resizable 从 manifest 派生（不再恒 true）', () => {
    registerBuiltinApps()
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        {
          id: 'win-calc',
          appId: 'com.ageha.calculator',
          title: '计算器',
          x: 10,
          y: 10,
          width: 300,
          height: 440,
          state: 'normal',
          spaceId: DEFAULT_SPACE_ID,
          restoreBounds: null,
          zIndex: 3,
        },
      ]),
    )
    hydratePersistedWindows()
    expect(useWindowStore.getState().windows[0]?.resizable).toBe(false)
  })
})

describe('hydrate 焦点选择（C1 审查）', () => {
  it('活跃 Space 内 zIndex 最大的非最小化窗获得焦点；全最小化保持无焦点', () => {
    registerBuiltinApps()
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        {
          id: 'win-min',
          appId: 'com.ageha.notes',
          title: '最小化',
          x: 10,
          y: 10,
          width: 900,
          height: 600,
          state: 'minimized',
          spaceId: DEFAULT_SPACE_ID,
          restoreBounds: null,
          zIndex: 9,
        },
        {
          id: 'win-normal',
          appId: 'com.ageha.notes',
          title: '常规',
          x: 20,
          y: 20,
          width: 900,
          height: 600,
          state: 'normal',
          spaceId: DEFAULT_SPACE_ID,
          restoreBounds: null,
          zIndex: 3,
        },
      ]),
    )
    hydratePersistedWindows()
    expect(useWindowStore.getState().windows.find((win) => win.id === 'win-normal')?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === 'win-min')?.focused).toBe(false)

    // 全最小化：恢复后无聚焦窗（engine.focus 拒绝最小化窗——不误选）。
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        {
          id: 'win-only',
          appId: 'com.ageha.notes',
          title: '仅最小化',
          x: 10,
          y: 10,
          width: 900,
          height: 600,
          state: 'minimized',
          spaceId: DEFAULT_SPACE_ID,
          restoreBounds: null,
          zIndex: 9,
        },
      ]),
    )
    resetWindowStore()
    hydratePersistedWindows()
    expect(useWindowStore.getState().windows.every((win) => !win.focused)).toBe(true)
  })
})
