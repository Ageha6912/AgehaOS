import { describe, expect, it } from 'vitest'

import { resolveActivation, resolveTileState } from './dock-space'
import type { DockWindowRef } from './dock-space'

/**
 * Dock Space 感知纯判定（W9，审计 .tmp/spaces-audit.md §12 决定 1/2）：
 * 瓷贴「最新窗」跨 Space 选取当前 Space 优先、两档指示映射、点击计划。
 */

const CURRENT = 'space-default'
const OTHER = 'space-other'

const ref = (overrides: Partial<DockWindowRef> & { id: string }): DockWindowRef => ({
  appId: 'com.ageha.files',
  spaceId: CURRENT,
  focused: false,
  state: 'normal',
  ...overrides,
})

describe('resolveTileState（W9 两档指示）', () => {
  it('无窗：latest=null、无指示（名称气泡档）', () => {
    expect(resolveTileState([], 'com.ageha.files', CURRENT)).toEqual({
      latest: null,
      tier: null,
    })
  })

  it('当前 Space 聚焦可见窗：active 档（既有 primary 条语义零变化）', () => {
    const state = resolveTileState([ref({ id: 'a', focused: true })], 'com.ageha.files', CURRENT)
    expect(state.tier).toBe('active')
    expect(state.latest?.id).toBe('a')
  })

  it('当前 Space 未聚焦/最小化窗：无指示（既有「不亮」口径）', () => {
    expect(resolveTileState([ref({ id: 'a' })], 'com.ageha.files', CURRENT).tier).toBeNull()
    expect(
      resolveTileState(
        [ref({ id: 'a', focused: true, state: 'minimized' })],
        'com.ageha.files',
        CURRENT,
      ).tier,
    ).toBeNull()
  })

  it('窗在其他 Space：elsewhere 档（subtle 圆点+标注），无当前 Space 窗即回落跨 Space 最新窗', () => {
    const state = resolveTileState(
      [ref({ id: 'a', spaceId: OTHER })],
      'com.ageha.files',
      CURRENT,
    )
    expect(state.tier).toBe('elsewhere')
    expect(state.latest?.id).toBe('a')
  })

  it('双窗跨 Space：当前 Space 最新窗优先——active 判定不被他 Space 更新窗顶掉（§12 决定 1 钉扎）', () => {
    // 数组序=创建序：他 Space 窗创建更晚（「全局最新」），但当前 Space 窗
    // 聚焦 → 瓷贴仍是 active 档，不降级为 elsewhere。
    const state = resolveTileState(
      [ref({ id: 'current', focused: true }), ref({ id: 'later-elsewhere', spaceId: OTHER })],
      'com.ageha.files',
      CURRENT,
    )
    expect(state.latest?.id).toBe('current')
    expect(state.tier).toBe('active')

    // 反向：当前 Space 窗未聚焦（他 Space 窗聚焦）→ 当前 Space 窗仍是代表窗，
    // 落「无指示」档（不因他 Space 窗聚焦而亮 elsewhere）。
    const flipped = resolveTileState(
      [ref({ id: 'current' }), ref({ id: 'later-elsewhere', spaceId: OTHER, focused: true })],
      'com.ageha.files',
      CURRENT,
    )
    expect(flipped.latest?.id).toBe('current')
    expect(flipped.tier).toBeNull()
  })

  it('同 Space 多窗取末位（创建序最新）', () => {
    const state = resolveTileState(
      [ref({ id: 'older', focused: true }), ref({ id: 'newer' })],
      'com.ageha.files',
      CURRENT,
    )
    expect(state.latest?.id).toBe('newer')
  })
})

describe('resolveActivation（W9 点击语义，§12 决定 2）', () => {
  it('无窗：launch', () => {
    expect(resolveActivation({ latest: null, tier: null })).toEqual({ kind: 'launch' })
  })

  it('其他 Space 窗：cross-space（switchSpace+restore/focus，不把窗拉过来）', () => {
    expect(
      resolveActivation(
        resolveTileState([ref({ id: 'a', spaceId: OTHER })], 'com.ageha.files', CURRENT),
      ),
    ).toEqual({ kind: 'cross-space', spaceId: OTHER, windowId: 'a' })
  })

  it('当前 Space 窗：toggle（既有语义零变化，携带 focused/minimized 现场）', () => {
    expect(
      resolveActivation(
        resolveTileState([ref({ id: 'a', focused: true })], 'com.ageha.files', CURRENT),
      ),
    ).toEqual({ kind: 'toggle', windowId: 'a', focused: true, minimized: false })
    expect(
      resolveActivation(
        resolveTileState(
          [ref({ id: 'a', focused: true, state: 'minimized' })],
          'com.ageha.files',
          CURRENT,
        ),
      ),
    ).toEqual({ kind: 'toggle', windowId: 'a', focused: true, minimized: true })
  })
})
