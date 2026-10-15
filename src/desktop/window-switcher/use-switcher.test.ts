import { describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import {
  createWindowSwitcher,
  resetWindowSwitcher,
  snapshotSwitcherWindows,
  windowSwitcher,
  type SwitcherCommitDirective,
  type SwitcherWindow,
} from './use-switcher'

/**
 * Window Switcher 状态机（W6，审计 .tmp/spaces-audit.md §9）钉扎：边缘态
 * （0/1/多窗）、cycle/commit 三段、关窗竞态顺延、轻点零指令、minimized 提交
 * 转 restore+focus。
 */

function win(
  id: string,
  overrides: Partial<SwitcherWindow> = {},
): SwitcherWindow {
  return {
    id,
    appId: 'com.ageha.notes',
    title: id,
    zIndex: 1,
    state: 'normal',
    focused: false,
    ...overrides,
  }
}

/** z 降序两窗：b 在顶（zIndex 2）且持有焦点——「z 序下一位」= a。 */
function twoWindows(): SwitcherWindow[] {
  return [win('b', { zIndex: 2, focused: true }), win('a', { zIndex: 1 })]
}

function createSpyMachine() {
  const applied: SwitcherCommitDirective[] = []
  const machine = createWindowSwitcher({ applyFocus: (directive) => applied.push(directive) })
  return { machine, applied }
}

describe('window switcher 状态机（W6 审计 §9）', () => {
  it('0 窗不开面板', () => {
    const { machine } = createSpyMachine()

    machine.open([])

    expect(machine.getState().open).toBe(false)
  })

  it('1 窗轻点 no-op 且按住也不开面板（open 以 <2 窗拒绝）', () => {
    const { machine } = createSpyMachine()

    machine.open([win('a', { focused: true })])
    expect(machine.getState().open).toBe(false)

    machine.cycle()
    expect(machine.getState().open).toBe(false)

    // 面板未开时 commit/cancel 零作用
    expect(machine.commit([win('a', { focused: true })])).toBeNull()
  })

  it('多窗开面板：预选=当前聚焦窗（轻点首按 cycleWindows 已落的焦点）', () => {
    const { machine, applied } = createSpyMachine()

    machine.open(twoWindows())

    const state = machine.getState()
    expect(state.open).toBe(true)
    expect(state.selectedId).toBe('b') // 聚焦窗（z 顶）即预选
    expect(state.windows.map((win) => win.id)).toEqual(['b', 'a']) // z 降序原样
    expect(applied).toEqual([]) // open 本身零聚焦指令（焦点已由轻点路径落位）
  })

  it('无聚焦窗（全最小化）时预选回落 z 顶', () => {
    const { machine } = createSpyMachine()

    machine.open([
      win('b', { zIndex: 2, state: 'minimized' }),
      win('a', { zIndex: 1, state: 'minimized' }),
    ])

    expect(machine.getState().selectedId).toBe('b')
  })

  it('cycle 循环下一位（wrap）：可见窗即时聚焦（applyFocus minimized:false）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())

    machine.cycle() // b → a

    expect(machine.getState().selectedId).toBe('a')
    expect(applied).toEqual([{ windowId: 'a', minimized: false }])

    machine.cycle() // a → b（wrap）
    expect(machine.getState().selectedId).toBe('b')
    expect(applied).toEqual([
      { windowId: 'a', minimized: false },
      { windowId: 'b', minimized: false },
    ])
  })

  it('cycle 到 minimized：只移动选中、不即时聚焦（还原留给 commit）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open([win('a', { zIndex: 2, focused: true }), win('m', { zIndex: 1, state: 'minimized' })])

    machine.cycle() // a → m

    expect(machine.getState().selectedId).toBe('m')
    expect(applied).toEqual([]) // 浏览期间不高亮即还原
  })

  it('轻点（未 cycle 过）commit：零聚焦指令、面板关——轻点路径与迁移前逐字节一致', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())

    const directive = machine.commit(twoWindows())

    expect(directive).toBeNull()
    expect(applied).toEqual([]) // 连多余 window.focused 都不发
    expect(machine.getState().open).toBe(false)
  })

  it('commit 提交选中可见窗；已聚焦的可见窗不重复 applyFocus', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())
    machine.cycle() // b → a（a 已被即时聚焦）

    // live 快照：a 现持焦点（cycle 的 applyFocus 落位后的真实形态）
    const directive = machine.commit([win('a', { zIndex: 2, focused: true }), win('b', { zIndex: 1 })])

    expect(directive).toEqual({ windowId: 'a', minimized: false })
    // cycle 已聚焦 a；commit 不重复发（零多余事件）
    expect(applied).toEqual([{ windowId: 'a', minimized: false }])
    expect(machine.getState().open).toBe(false)
  })

  it('commit 提交未聚焦的可见窗 → applyFocus focus 指令', () => {
    const { machine, applied } = createSpyMachine()
    machine.open([win('a', { zIndex: 2, focused: true }), win('m', { zIndex: 1, state: 'minimized' })])
    machine.cycle() // 选中 m（minimized 不即时聚焦）

    // commit 前 m 已被外部还原为可见但未聚焦（live 快照为准 → focus 指令）
    const directive = machine.commit([win('a', { zIndex: 2 }), win('m', { zIndex: 1 })])

    expect(directive).toEqual({ windowId: 'm', minimized: false })
    expect(applied).toEqual([{ windowId: 'm', minimized: false }])
  })

  it('commit 提交 minimized → restore+focus 指令（minimized:true）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open([win('a', { zIndex: 2, focused: true }), win('m', { zIndex: 1, state: 'minimized' })])
    machine.cycle() // a → m

    const directive = machine.commit([
      win('a', { zIndex: 2 }),
      win('m', { zIndex: 1, state: 'minimized' }),
    ])

    expect(directive).toEqual({ windowId: 'm', minimized: true })
    expect(applied).toEqual([{ windowId: 'm', minimized: true }])
    expect(machine.getState().open).toBe(false)
  })

  it('关窗竞态：commit 时选中已不在 live 列表 → 按会话序列同位顺延后提交', () => {
    const { machine, applied } = createSpyMachine()
    // 会话序列 [c, b, a]，选中 c
    machine.open([
      win('c', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('a', { zIndex: 1 }),
    ])
    machine.cycle() // 选中 b（cycled=true）
    // b 在提交前一刻被关闭（竞态）：live 只剩 [c, a]
    const directive = machine.commit([
      win('c', { zIndex: 3, focused: true }),
      win('a', { zIndex: 1 }),
    ])

    // 选中 b 失效 → 按会话序列同位（index 1）顺延到 a 后提交
    expect(directive).toEqual({ windowId: 'a', minimized: false })
    expect(applied).toEqual([
      { windowId: 'b', minimized: false }, // cycle 即时聚焦 b
      { windowId: 'a', minimized: false }, // commit 顺延后的聚焦
    ])
    expect(machine.getState().open).toBe(false)
  })

  it('关窗竞态：commit 时 live 列表已空 → 关面板零指令', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())
    machine.cycle()
    applied.length = 0 // cycle 的即时聚焦已单独断言过，这里只看 commit

    expect(machine.commit([])).toBeNull()
    expect(applied).toEqual([])
    expect(machine.getState().open).toBe(false)
  })

  it('windowsChanged：选中失效自动顺延（同位取新条目）', () => {
    const { machine } = createSpyMachine()
    machine.open([
      win('c', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('a', { zIndex: 1 }),
    ])

    // c 关闭 → 顺延到同位（index 0）的 b
    machine.windowsChanged([win('b', { zIndex: 2, focused: true }), win('a', { zIndex: 1 })])

    expect(machine.getState().open).toBe(true)
    expect(machine.getState().selectedId).toBe('b')
  })

  it('windowsChanged：列表 <2 窗自动关面板（不提交）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())

    machine.windowsChanged([win('a', { focused: true })])

    expect(machine.getState().open).toBe(false)
    expect(applied).toEqual([])
  })

  it('windowsChanged：会话序列稳定——消失项移除、存活项原位、新窗追加', () => {
    const { machine } = createSpyMachine()
    machine.open([
      win('c', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('a', { zIndex: 1 }),
    ])

    // cycle 聚焦会把 live z 序打乱（a 被聚焦后 zIndex 跳顶）；合并不得按 live
    // z 重排会话序列，只更新字段。b 关闭、新窗 d 开启。
    machine.windowsChanged([
      win('a', { zIndex: 9, focused: true }),
      win('d', { zIndex: 8 }),
      win('c', { zIndex: 1 }),
    ])

    expect(machine.getState().windows.map((entry) => entry.id)).toEqual(['c', 'a', 'd'])
    // 字段随 live 更新：a（live 中持焦点）带焦点、c 不带
    expect(machine.getState().windows.find((entry) => entry.id === 'a')?.focused).toBe(true)
    expect(machine.getState().windows.find((entry) => entry.id === 'c')?.focused).toBe(false)
  })

  it('cancel：关面板零聚焦指令（Esc 语义，不切换）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())
    machine.cycle()
    applied.length = 0 // cycle 的即时聚焦已单独断言过，这里只看 cancel

    machine.cancel()

    expect(applied).toEqual([])
    expect(machine.getState().open).toBe(false)
  })
})

describe('window switcher 单例（live store 接线，W6 审计 §9）', () => {
  it('minimized 提交转 restore+focus 组合（taskbar 同款）', () => {
    resetWindowStore()
    resetSpaceStore()
    resetWindowSwitcher()
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second)

    windowSwitcher.openFromLive()
    windowSwitcher.cycleFromLive() // first → second（minimized）

    windowSwitcher.commitFromLive()

    const windows = useWindowStore.getState().windows
    const target = windows.find((entry) => entry.id === second)
    expect(target?.state).not.toBe('minimized') // restore
    expect(target?.focused).toBe(true) // + focus（restore 自 minimized 回落内部已聚焦）
    expect(windows.find((entry) => entry.id === first)?.focused).toBe(false)
  })

  it('快照派生：只含 active Space、z 降序、含 minimized', () => {
    resetWindowStore()
    resetSpaceStore()
    resetWindowSwitcher()
    const low = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const high = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const other = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.settings', title: '设置', spaceId: 'space-other' })

    const snapshot = snapshotSwitcherWindows()

    expect(snapshot.map((entry) => entry.id)).toEqual([high, low]) // z 降序
    expect(snapshot.some((entry) => entry.id === other)).toBe(false) // 其他 Space 不入列
    expect(useSpaceStore.getState().activeSpaceId).toBe(DEFAULT_SPACE_ID)

    // minimized 留在列表里（切换器可切到最小化窗）
    useWindowStore.getState().minimize(low)
    expect(snapshotSwitcherWindows().some((entry) => entry.id === low)).toBe(true)
  })
})
