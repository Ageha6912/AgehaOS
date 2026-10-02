import { afterEach, describe, expect, it } from 'vitest'

import {
  getWorkspaceViewport,
  MENUBAR_HEIGHT_PX,
  RAIL_LEFT_WIDTH_PX,
  RAIL_RIGHT_WIDTH_PX,
} from './viewport'

describe('getWorkspaceViewport', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true })
  })

  it('deducts the persistent menu bar height from the workspace (§19)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

    // 1000 ≥ sm 断点：宽度同时扣减左侧系统导航栏（§26）。
    expect(getWorkspaceViewport()).toEqual({
      width: 1000 - RAIL_LEFT_WIDTH_PX,
      height: 800 - MENUBAR_HEIGHT_PX,
    })
  })

  it('deducts the left rail at >=640px, the right widget rail at >=1280px (§26/§27)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    expect(getWorkspaceViewport().width).toBe(800 - RAIL_LEFT_WIDTH_PX)

    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    expect(getWorkspaceViewport().width).toBe(1440 - RAIL_LEFT_WIDTH_PX - RAIL_RIGHT_WIDTH_PX)

    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true })
    expect(getWorkspaceViewport().width).toBe(375)
  })

  it('keeps the TS constants in lockstep with the CSS tokens (menubar + both rails)', () => {
    // 与 src/index.css.test.ts 的 32px/80px/296px 值钉扎互为双保险——改任
    // 一侧都会红（§32；Shell 2.0 切片一：互指从菜单栏扩到双栏，防 TS 常量
    // 漏改/回漂无红测——左栏漏改 = 工作区钳制宽度错 52px）。
    expect(MENUBAR_HEIGHT_PX).toBe(32)
    expect(RAIL_LEFT_WIDTH_PX).toBe(80)
    expect(RAIL_RIGHT_WIDTH_PX).toBe(296)
  })
})
