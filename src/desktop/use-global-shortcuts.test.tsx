import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import { resetMissionControlStore, useMissionControlStore } from '@/store/mission-control-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { resetShortcutRegistry } from './shortcuts/registry'
import { resetWindowSwitcher, windowSwitcher } from './window-switcher/use-switcher'
import { cycleWindows, useGlobalShortcuts } from './use-global-shortcuts'

function Harness(): null {
  useGlobalShortcuts()
  return null
}

beforeEach(() => {
  resetShortcutRegistry()
  resetSearchStore()
  resetWindowStore()
  resetSpaceStore()
  // W7（审计 .tmp/spaces-audit.md §10）：Mission Control 状态逐用例复位。
  resetMissionControlStore()
})

// W6（审计 .tmp/spaces-audit.md §9）：窗口切换器状态机逐用例复位——只追加，
// 既有用例零改动（面板态不跨用例泄漏，行为与迁移前一致）。
beforeEach(() => {
  resetWindowSwitcher()
})

describe('global shortcuts (PRD §15/§26)', () => {
  it('toggles the search palette with Ctrl+K and closes with Escape', () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(useSearchStore.getState().open).toBe(true)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, metaKey: false })
    expect(useSearchStore.getState().open).toBe(false)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('cycles focus across visible windows with Alt+W', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    // 两个窗口都是 normal；当前焦点在最后打开的 second 上。
    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
  })

  it('ignores Alt+W with fewer than two visible windows', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })
})

describe('space 切换快捷键（W3，审计 .tmp/spaces-audit.md §6）', () => {
  it('Ctrl+Alt+→ 切到下一个 Space、Ctrl+Alt+← 切回（按 index 轮转）', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(second)

    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('末位按 → 回绕到首位', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useSpaceStore.getState().switchSpace(second)
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('单 Space 时切换快捷键 no-op；普通方向键（无 Ctrl+Alt）不触发切换', () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(useSpaceStore.getState().spaces).toHaveLength(1)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true, shiftKey: true })
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
  })
})

describe('cycleWindows', () => {
  it('skips minimized windows', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const third = useWindowStore.getState().open({ appId: 'com.ageha.settings', title: '设置' })
    useWindowStore.getState().minimize(second)

    cycleWindows()

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(windows.find((win) => win.id === third)?.focused).toBe(false)
  })

  it('只在当前 Space 的可见窗口间轮转（W2，审计 .tmp/spaces-audit.md §5 决定 4）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const other = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件', spaceId: 'space-other' })
    const third = useWindowStore.getState().open({ appId: 'com.ageha.settings', title: '设置' })
    expect(useSpaceStore.getState().activeSpaceId).not.toBe('space-other')

    cycleWindows()

    let windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === first)?.focused).toBe(true)
    // 其他 Space 的窗口既不参与轮转也不被聚焦。
    expect(windows.find((win) => win.id === other)?.focused).toBe(false)

    cycleWindows()

    windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === third)?.focused).toBe(true)
    expect(windows.find((win) => win.id === other)?.focused).toBe(false)
  })
})

// W7 Mission Control 快捷键（审计 .tmp/spaces-audit.md §10）：F4 toggle、
// Esc 关闭（注册序在搜索 Esc 之前）、inline 重命名编辑中 Esc 让位。
describe('Mission Control 快捷键（W7）', () => {
  it('F4 开启 Mission Control，再按关闭（toggle）', () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'F4' })
    expect(useMissionControlStore.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'F4' })
    expect(useMissionControlStore.getState().open).toBe(false)
  })

  it('MC 开启时 Esc 归 MC 关闭（先于搜索 Esc 命中），不开搜索', () => {
    render(<Harness />)
    useMissionControlStore.getState().setOpen(true)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('MC 开启且搜索面板也在（防御）：Esc 先关 MC，搜索不动', () => {
    render(<Harness />)
    useMissionControlStore.getState().setOpen(true)
    useSearchStore.getState().setOpen(true)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useSearchStore.getState().open).toBe(true)
  })

  it('MC 关闭时 Esc 不开 MC（既有「关搜索」语义零变化）', () => {
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(useMissionControlStore.getState().open).toBe(false)
  })

  it('inline 重命名编辑中 Esc 让位：MC 不关（编辑态原样）', () => {
    render(<Harness />)
    useMissionControlStore.getState().setOpen(true)
    useMissionControlStore.getState().setEditing(DEFAULT_SPACE_ID)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(useMissionControlStore.getState().open).toBe(true)
    expect(useMissionControlStore.getState().editingSpaceId).toBe(DEFAULT_SPACE_ID)
  })
})

// W6 Window Switcher 三段交互（审计 .tmp/spaces-audit.md §9）：轻点=既有
// cycleWindows 路径（逐字节一致）；按住=面板循环选择；keyup=提交；
// keyup 丢失由 WindowSwitcher 组件的 window blur 兜底提交（组件测试钉扎）。
describe('Window Switcher 三段交互（W6）', () => {
  it('轻点（按下即松）轮转一次焦点，keyup 后面板关闭', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(windowSwitcher.getState().open).toBe(true) // 按住期面板在场

    fireEvent.keyUp(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(false) // 松开提交即收
    // 轻点=一次轮转，不多不少（连多余 window.focused 都不产生）
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)
  })

  it('单窗轻点 no-op 且按住（repeat keydown）也不开面板', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(false)

    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })
    expect(windowSwitcher.getState().open).toBe(false)

    fireEvent.keyUp(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })

  it('按住：repeat keydown 循环选中，keyup（无论 altKey）提交 minimized → restore+focus', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second) // first 被 focusTopmost 聚焦
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true) // 含 minimized 共 2 窗 → 开面板
    expect(windowSwitcher.getState().selectedId).toBe(first)

    // 按住 auto-repeat：循环到 minimized 窗（只移选中、不抢还原）
    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })
    expect(windowSwitcher.getState().selectedId).toBe(second)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.state).toBe(
      'minimized',
    )

    // keyup 丢 Alt 修饰（Alt 先于 W 松开的竞态）也必须提交——「无论 altKey」
    fireEvent.keyUp(window, { key: 'w' })

    const target = useWindowStore.getState().windows.find((win) => win.id === second)
    expect(target?.state).not.toBe('minimized') // restore
    expect(target?.focused).toBe(true) // + focus
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)
    expect(windowSwitcher.getState().open).toBe(false)
  })

  it('repeat 循环到可见窗：即时聚焦，keyup 提交不重复切换', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })

    // 即时聚焦：repeat 循环到 second（first 随之失焦）
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)

    fireEvent.keyUp(window, { key: 'w' })

    // keyup 提交：选中已聚焦 → 不重复切换；面板收起
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(windowSwitcher.getState().open).toBe(false)
  })

  it('面板开启期间普通 w keydown（无 Alt）也循环选中（keyup 丢修饰硬化）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'w' }) // 无 Alt
    expect(windowSwitcher.getState().selectedId).toBe(second)

    fireEvent.keyUp(window, { key: 'w' })
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)
  })

  it('Esc 面板开启 → cancel 不切换（若搜索 Esc 先命中面板不会关——钉注册序）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(windowSwitcher.getState().open).toBe(false) // switcher Esc 先命中并取消
    // 不切换：焦点保持 open 路径落下的 first
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)

    // 取消后的 keyup 零作用（不提交）
    fireEvent.keyUp(window, { key: 'w' })
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)
  })

  it('关闭窗口到 <2 窗：面板开启期间自动收起（live store 派生）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)

    // 关掉一扇（不经组件订阅——keydown 路径 cycleFromLive 同样从 live 派生）
    useWindowStore.getState().close(second)
    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })

    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
  })
})
