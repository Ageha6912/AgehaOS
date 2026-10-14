import { describe, expect, it } from 'vitest'

import { parsePersistedWindows, parsePersistedWindowsText, serializeWindows } from './window-persist'
import type { PersistedWindow } from './window-persist'

function entry(overrides: Partial<PersistedWindow> = {}): PersistedWindow {
  return {
    id: 'win-1',
    appId: 'com.ageha.notes',
    title: '记事',
    x: 176,
    y: 176,
    width: 900,
    height: 600,
    state: 'normal',
    spaceId: 'space-default',
    restoreBounds: null,
    zIndex: 3,
    ...overrides,
  }
}

describe('window-persist（W2 窗口持久化 schema，审计 §5 决定 2）', () => {
  it('serialize → parse round-trip 保留几何/状态/归属', () => {
    const windows = [
      entry(),
      entry({
        id: 'win-2',
        state: 'maximized',
        restoreBounds: { x: 10, y: 20, width: 500, height: 400 },
        zIndex: 9,
      }),
    ]

    const parsed = parsePersistedWindows(JSON.parse(serializeWindows(windows)) as unknown)

    expect(parsed).toEqual(windows)
  })

  it('损坏 JSON / version 不符 / 缺字段 / 非法 state → 整体丢弃（null）', () => {
    expect(parsePersistedWindowsText('{not json')).toBeNull()
    expect(parsePersistedWindowsText('null')).toBeNull()

    expect(parsePersistedWindows({ version: 2, windows: [entry()] })).toBeNull()
    expect(parsePersistedWindows({ windows: [entry()] })).toBeNull()
    expect(parsePersistedWindows({ version: 1, windows: 'nope' })).toBeNull()

    // 任一条目缺关键字段 → 整体 null（结构校验是全有或全无）。
    const broken = entry() as unknown as Record<string, unknown>
    delete broken.spaceId
    expect(parsePersistedWindows({ version: 1, windows: [entry(), broken] })).toBeNull()

    expect(parsePersistedWindows({ version: 1, windows: [entry({ state: 'floating' as never })] })).toBeNull()
    expect(
      parsePersistedWindows({ version: 1, windows: [entry({ restoreBounds: { x: 'a' } as never })] }),
    ).toBeNull()
  })

  it('非 JSON 文本经 parsePersistedWindowsText 回落 null（损坏回落空桌面的入口）', () => {
    expect(parsePersistedWindowsText(null)).toBeNull()
    expect(parsePersistedWindowsText('[]')).toBeNull()
    expect(parsePersistedWindowsText('{"version":1,"windows":[]}')).toEqual([])
  })

  it('W4 可选字段：snapMode/restoreState round-trip（version 仍为 1）', () => {
    const windows = [
      entry({ state: 'snapped', snapMode: 'right', restoreState: 'normal' }),
      entry({
        id: 'win-max',
        state: 'maximized',
        restoreState: 'snapped',
        restoreBounds: { x: 10, y: 20, width: 500, height: 400 },
      }),
    ]

    const parsed = parsePersistedWindows(JSON.parse(serializeWindows(windows)) as unknown)

    expect(parsed).toEqual(windows)
  })

  it('W4 旧载荷缺字段：合法且不落键（前向兼容，缺省补齐在 toWindowInstance）', () => {
    const raw = entry()
    const parsed = parsePersistedWindows({ version: 1, windows: [raw] })

    expect(parsed).toEqual([raw])
    expect('snapMode' in parsed![0]!).toBe(false)
    expect('restoreState' in parsed![0]!).toBe(false)
    // 显式 null 与缺失等价（读端回落缺省，不清桌面）。
    expect(parsePersistedWindows({ version: 1, windows: [entry({ snapMode: null })] })).toEqual([
      raw,
    ])
  })

  it('W4 非法字段值 → 整体丢弃（与 restoreBounds 同口径）', () => {
    expect(
      parsePersistedWindows({ version: 1, windows: [entry({ snapMode: 'top' as never })] }),
    ).toBeNull()
    expect(
      parsePersistedWindows({ version: 1, windows: [entry({ restoreState: 'minimized' as never })] }),
    ).toBeNull()
    expect(
      parsePersistedWindows({ version: 1, windows: [entry({ snapMode: 3 as never })] }),
    ).toBeNull()
  })
})
