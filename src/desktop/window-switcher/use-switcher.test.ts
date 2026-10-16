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
 * Window Switcher 状态机钉扎。**W11 真机反馈改版（审计 .tmp/spaces-audit.md
 * §13 A，用户裁决，覆盖 W6「松开提交」三段交互）**：Alt+W keydown 开**常驻
 * 面板**（选中=z 序下一位）、keyup 一律不提交、提交=点击条目（choose）或
 * Enter（commit）、取消=Esc/backdrop/blur。W6 的「轻点（未 cycle）commit 零
 * 指令」等效语义与 cycled 标志随裁决移除——commit 现在永远是真提交；旧用例
 * 已按新语义改写（各用例注明）。
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

describe('window switcher 状态机（W6 边缘态 + W11 常驻面板改版）', () => {
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

    // 面板未开时 commit/choose 零作用
    expect(machine.commit([win('a', { focused: true })])).toBeNull()
    expect(machine.choose('a', [win('a', { focused: true })])).toBeNull()
  })

  it('多窗开面板：选中=z 序下一位 + 可见窗即时聚焦（W11 改版；W6 旧语义「预选当前聚焦窗」随用户裁决移除）', () => {
    const { machine, applied } = createSpyMachine()

    machine.open(twoWindows())

    const state = machine.getState()
    expect(state.open).toBe(true)
    expect(state.selectedId).toBe('a') // 聚焦窗 b 的 z 序下一位
    expect(state.windows.map((win) => win.id)).toEqual(['b', 'a']) // z 降序原样
    // keydown 只开面板、不再先跑 cycleWindows——z-next 聚焦由 open 即时落
    // （与 cycle 同「跟手」语义；旧实现靠 keydown 先行 cycleWindows）。
    expect(applied).toEqual([{ windowId: 'a', minimized: false }])
  })

  it('无聚焦窗（全最小化）时选中回落 z 顶，且不即时聚焦', () => {
    const { machine, applied } = createSpyMachine()

    machine.open([
      win('b', { zIndex: 2, state: 'minimized' }),
      win('a', { zIndex: 1, state: 'minimized' }),
    ])

    expect(machine.getState().selectedId).toBe('b')
    expect(applied).toEqual([]) // minimized 不抢还原——留给 commit 的 restore+focus
  })

  it('cycle 循环下一位（wrap）：可见窗即时聚焦（applyFocus minimized:false）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows()) // 选中 a（open 已聚焦 a）

    machine.cycle() // a → b（wrap）
    expect(machine.getState().selectedId).toBe('b')
    expect(applied).toEqual([
      { windowId: 'a', minimized: false }, // open 的即时聚焦
      { windowId: 'b', minimized: false }, // cycle 的即时聚焦
    ])
  })

  it('cycle 到 minimized：只移动选中、不即时聚焦（还原留给 commit）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open([
      win('a', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('m', { zIndex: 1, state: 'minimized' }),
    ])
    applied.length = 0 // open 对 b 的即时聚焦已单独断言过，这里只看 cycle

    machine.cycle() // b → m
    expect(machine.getState().selectedId).toBe('m')
    expect(applied).toEqual([]) // 浏览期间不高亮即还原

    machine.cycle() // m → a：可见窗恢复即时聚焦
    expect(machine.getState().selectedId).toBe('a')
    expect(applied).toEqual([{ windowId: 'a', minimized: false }])
  })

  it('commit=真提交（W11 裁决：keyup 不再提交，commit 只由 Enter/点击触达）——未循环过也提交选中', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows()) // 选中 a + 即时聚焦 a

    // live 快照：a 已持焦点（open 落位后的真实形态）
    const directive = machine.commit([win('a', { zIndex: 2, focused: true }), win('b', { zIndex: 1 })])

    expect(directive).toEqual({ windowId: 'a', minimized: false })
    // open 已聚焦 a；commit 不重复发（零多余事件）
    expect(applied).toEqual([{ windowId: 'a', minimized: false }])
    expect(machine.getState().open).toBe(false)
  })

  it('commit 提交未聚焦的可见窗 → applyFocus focus 指令', () => {
    const { machine, applied } = createSpyMachine()
    // 选中 m（minimized，open 不即时聚焦）
    machine.open([win('a', { zIndex: 2, focused: true }), win('m', { zIndex: 1, state: 'minimized' })])

    // commit 前 m 已被外部还原为可见但未聚焦（live 快照为准 → focus 指令）
    const directive = machine.commit([win('a', { zIndex: 2 }), win('m', { zIndex: 1 })])

    expect(directive).toEqual({ windowId: 'm', minimized: false })
    expect(applied).toEqual([{ windowId: 'm', minimized: false }])
  })

  it('commit 提交 minimized → restore+focus 指令（minimized:true）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open([win('a', { zIndex: 2, focused: true }), win('m', { zIndex: 1, state: 'minimized' })])

    const directive = machine.commit([
      win('a', { zIndex: 2 }),
      win('m', { zIndex: 1, state: 'minimized' }),
    ])

    expect(directive).toEqual({ windowId: 'm', minimized: true })
    expect(applied).toEqual([{ windowId: 'm', minimized: true }])
    expect(machine.getState().open).toBe(false)
  })

  it('choose：点击条目=把选中切到被点窗再走同一提交流（W11 决定 3）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows()) // 选中 a + 聚焦 a
    applied.length = 0

    // 用户点 b 的条目（live：a 持焦点）
    const directive = machine.choose('b', [win('a', { zIndex: 2, focused: true }), win('b', { zIndex: 1 })])

    expect(directive).toEqual({ windowId: 'b', minimized: false })
    expect(applied).toEqual([{ windowId: 'b', minimized: false }])
    expect(machine.getState().open).toBe(false)
  })

  it('choose：被点窗不在 live 列表（点击瞬间被关）→ 维持原选中走顺延提交', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows()) // 选中 a + 聚焦 a
    applied.length = 0

    // b 已不在 live：choose 不切选中，a 已聚焦 → 提交零多余 focus
    const directive = machine.choose('b', [win('a', { zIndex: 2, focused: true })])

    expect(directive).toEqual({ windowId: 'a', minimized: false })
    expect(applied).toEqual([]) // a 已聚焦，不重复发
    expect(machine.getState().open).toBe(false)
  })

  it('关窗竞态：commit 时选中已不在 live 列表 → 按会话序列同位顺延后提交', () => {
    const { machine, applied } = createSpyMachine()
    // 会话序列 [c, b, a]：open 选中 z-next=b（即时聚焦 b）
    machine.open([
      win('c', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('a', { zIndex: 1 }),
    ])
    // b 在提交前一刻被关闭（竞态）：live 只剩 [c, a]
    const directive = machine.commit([
      win('c', { zIndex: 3, focused: true }),
      win('a', { zIndex: 1 }),
    ])

    // 选中 b 失效 → 按会话序列同位（index 1）顺延到 a 后提交
    expect(directive).toEqual({ windowId: 'a', minimized: false })
    expect(applied).toEqual([
      { windowId: 'b', minimized: false }, // open 即时聚焦 b
      { windowId: 'a', minimized: false }, // commit 顺延后的聚焦
    ])
    expect(machine.getState().open).toBe(false)
  })

  it('关窗竞态：commit 时 live 列表已空 → 关面板零指令', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())
    applied.length = 0 // open 的即时聚焦已单独断言过，这里只看 commit

    expect(machine.commit([])).toBeNull()
    expect(applied).toEqual([])
    expect(machine.getState().open).toBe(false)
  })

  it('windowsChanged：选中失效自动顺延（同位取新条目）', () => {
    const { machine } = createSpyMachine()
    // open 选中 z-next=b（W11 改版：不再预选聚焦窗 c）
    machine.open([
      win('c', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('a', { zIndex: 1 }),
    ])
    expect(machine.getState().selectedId).toBe('b')

    // 选中窗 b 关闭 → 顺延到同位（index 1）的 a
    machine.windowsChanged([win('c', { zIndex: 3, focused: true }), win('a', { zIndex: 1 })])

    expect(machine.getState().open).toBe(true)
    expect(machine.getState().selectedId).toBe('a')
  })

  it('windowsChanged：列表 <2 窗自动关面板（不提交）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())
    const openFocusCount = applied.length // open 的即时聚焦
    expect(openFocusCount).toBe(1)

    machine.windowsChanged([win('a', { focused: true })])

    expect(machine.getState().open).toBe(false)
    expect(applied).toHaveLength(openFocusCount) // 收面板零提交指令
  })

  it('windowsChanged：会话序列稳定——消失项移除、存活项原位、新窗追加', () => {
    const { machine } = createSpyMachine()
    machine.open([
      win('c', { zIndex: 3, focused: true }),
      win('b', { zIndex: 2 }),
      win('a', { zIndex: 1 }),
    ])

    // cycle/open 聚焦会把 live z 序打乱（a 被聚焦后 zIndex 跳顶）；合并不得
    // 按 live z 重排会话序列，只更新字段。b 关闭、新窗 d 开启。
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

  it('cancel：关面板零聚焦指令（Esc/backdrop/blur 语义，不切换）', () => {
    const { machine, applied } = createSpyMachine()
    machine.open(twoWindows())
    applied.length = 0 // open 的即时聚焦已单独断言过，这里只看 cancel

    machine.cancel()

    expect(applied).toEqual([])
    expect(machine.getState().open).toBe(false)
  })
})

describe('window switcher 单例（live store 接线，W6/W11）', () => {
  it('minimized 提交转 restore+focus 组合（taskbar 同款）', () => {
    resetWindowStore()
    resetSpaceStore()
    resetWindowSwitcher()
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second)

    // W11：open 直接选中 z-next=second（minimized，不即时聚焦）；commit 走
    // restore+focus（旧用例的 cycleFromLive 步骤随「open 预选 z-next」移除）。
    windowSwitcher.openFromLive()
    expect(windowSwitcher.getState().selectedId).toBe(second)

    windowSwitcher.commitFromLive()

    const windows = useWindowStore.getState().windows
    const target = windows.find((entry) => entry.id === second)
    expect(target?.state).not.toBe('minimized') // restore
    expect(target?.focused).toBe(true) // + focus（restore 自 minimized 回落内部已聚焦）
    expect(windows.find((entry) => entry.id === first)?.focused).toBe(false)
  })

  it('chooseFromLive：点击条目提交该窗（live 快照存在性校验同源）', () => {
    resetWindowStore()
    resetSpaceStore()
    resetWindowSwitcher()
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    // 焦点先落 first（second 随后开、自带聚焦——显式归位使意图清晰）
    useWindowStore.getState().focus(first)
    windowSwitcher.openFromLive() // 选中 z-next=second（即时聚焦 second）

    windowSwitcher.chooseFromLive(first) // 点击 first 的条目

    const windows = useWindowStore.getState().windows
    expect(windows.find((entry) => entry.id === first)?.focused).toBe(true)
    expect(windows.find((entry) => entry.id === second)?.focused).toBe(false)
    expect(windowSwitcher.getState().open).toBe(false)
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
