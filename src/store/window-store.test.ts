import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@/core/window'
import { registerBuiltinApps, resetAppStore } from '@/store/app-store'

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

  it('appId 无 manifest 的窗口丢弃，合法条目照常恢复', () => {
    localStorage.setItem(
      WINDOWS_STORAGE_KEY,
      serializeWindows([
        persistedEntry({ id: 'win-ghost', appId: 'com.ageha.extinct' }),
        persistedEntry({ id: 'win-real', appId: 'com.ageha.notes', zIndex: 5 }),
      ]),
    )

    hydratePersistedWindows()

    const windows = useWindowStore.getState().windows
    expect(windows.map((win) => win.id)).toEqual(['win-real'])
    expect(windows[0]?.minWidth).toBe(MIN_WINDOW_WIDTH)
    expect(windows[0]?.resizable).toBe(true)
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
