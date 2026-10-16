import { fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import { resetMissionControlStore, useMissionControlStore } from '@/store/mission-control-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { resetShortcutRegistry } from './shortcuts/registry'
import { resetWindowSwitcher, windowSwitcher } from './window-switcher/use-switcher'
import { WindowSwitcher } from './window-switcher/WindowSwitcher'
import { cycleWindows, useGlobalShortcuts } from './use-global-shortcuts'

function Harness(): null {
  useGlobalShortcuts()
  return null
}

/** 面板在场壳（Enter 让位用例需要面板条目 DOM 与 registry 同场）。 */
function WindowSwitcherHarness(): ReactElement {
  return <WindowSwitcher />
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

// W11 Window Switcher 常驻面板改版（审计 .tmp/spaces-audit.md §13 A，用户裁
// 决，覆盖 W6「松开提交」三段交互）：Alt+W keydown 开常驻面板（选中=z 序下
// 一位 + 可见窗即时聚焦）、面板开启期 W keydown（repeat/再按）循环、**keyup
// 一律不提交**、提交=Enter（注册条目）或点击条目（WindowSwitcher.test 钉扎）、
// 取消=Esc（本文件钉注册序）/backdrop/blur（组件测试钉扎）。W6 旧用例已按新
// 语义改写（各用例注明裁决依据）。
describe('Window Switcher 常驻面板（W11 改版）', () => {
  it('多窗 keydown 开常驻面板：焦点即落 z 序下一位，keyup 后面板仍在（不提交）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    // open 即时聚焦 z-next（first），面板常驻
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(windowSwitcher.getState().open).toBe(true)

    // W11 裁决：keyup 一律不提交——面板常驻、焦点不动
    fireEvent.keyUp(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)
  })

  it('面板开启时 Enter=提交当前选中（面板收起、焦点保持）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)

    // 面板已关：Enter 不进 switcher（窗口状态零变化）
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
  })

  it('单窗轻点 no-op 且按住（repeat keydown）也不开面板（<2 窗零行为变化）', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(false)

    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })
    expect(windowSwitcher.getState().open).toBe(false)

    fireEvent.keyUp(window, { key: 'w', altKey: true })
    expect(useWindowStore.getState().windows[0]?.focused).toBe(true)
  })

  it('面板开启期 repeat keydown 循环选中；keyup 不提交；Enter 提交 minimized → restore+focus', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second) // first 被 focusTopmost 聚焦
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true) // 含 minimized 共 2 窗 → 开面板
    // W11：open 选中=z-next=second（minimized，不即时聚焦）
    expect(windowSwitcher.getState().selectedId).toBe(second)

    // repeat 循环回 first（可见 → 即时聚焦）
    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })
    expect(windowSwitcher.getState().selectedId).toBe(first)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)

    // 再循环回 second；keyup（丢 Alt 修饰的竞态形态）零作用——面板常驻、
    // minimized 不被还原（旧「keyup 提交」语义随 W11 裁决移除）
    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })
    fireEvent.keyUp(window, { key: 'w' })
    expect(windowSwitcher.getState().open).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.state).toBe(
      'minimized',
    )

    // Enter 提交 minimized → restore+focus
    fireEvent.keyDown(window, { key: 'Enter' })

    const target = useWindowStore.getState().windows.find((win) => win.id === second)
    expect(target?.state).not.toBe('minimized') // restore
    expect(target?.focused).toBe(true) // + focus
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)
    expect(windowSwitcher.getState().open).toBe(false)
  })

  it('repeat 循环到可见窗即时聚焦；keyup 不提交；Enter 提交不重复切换', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    fireEvent.keyDown(window, { key: 'w', altKey: true, repeat: true })

    // 即时聚焦：repeat 循环到 second（first 随之失焦）
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)

    // keyup 零作用（面板常驻）
    fireEvent.keyUp(window, { key: 'w' })
    expect(windowSwitcher.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'Enter' })

    // Enter 提交：选中已聚焦 → 不重复切换；面板收起
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(windowSwitcher.getState().open).toBe(false)
  })

  it('面板开启期间普通 w keydown（无 Alt）也循环选中（keyup 丢修饰硬化），Enter 收尾', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'w' }) // 无 Alt
    expect(windowSwitcher.getState().selectedId).toBe(second)

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)
    expect(windowSwitcher.getState().open).toBe(false)
  })

  it('Esc 面板开启 → cancel 不切换（若搜索 Esc 先命中面板不会关——钉注册序）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)

    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(windowSwitcher.getState().open).toBe(false) // switcher Esc 先命中并取消
    // 不追加切换：焦点保持 open 路径落下的 first
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)

    // 取消后的 keyup 零作用（W11 后恒为零作用）
    fireEvent.keyUp(window, { key: 'w' })
    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)
  })

  it('焦点落在面板条目上时 Enter 让位（原生激活自理，registry 不抢——防错位提交选中）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    render(<Harness />)
    render(<WindowSwitcherHarness />)
    fireEvent.keyDown(window, { key: 'w', altKey: true })
    expect(windowSwitcher.getState().open).toBe(true)
    // 选中=first；把 DOM 焦点放到 second 的条目按钮上
    const secondItem = document.querySelector(
      `[data-testid="window-switcher-item"][data-window-id="${second}"] button`,
    ) as HTMLButtonElement
    secondItem.focus()

    // 目标在面板内 → registry Enter 条目让位（不提交选中 first）
    fireEvent.keyDown(secondItem, { key: 'Enter' })
    expect(windowSwitcher.getState().open).toBe(true)
    expect(windowSwitcher.getState().selectedId).not.toBe(second)

    // 原生激活（Enter 的 default action=click）→ choose 该条目
    fireEvent.click(secondItem)
    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(false)
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
