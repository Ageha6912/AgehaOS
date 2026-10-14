import { afterEach, describe, expect, it } from 'vitest'

import {
  getWorkspaceBand,
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
    // 一侧都会红（§32；Shell 3.0 STEP 1 窄轨浮岛：互指从菜单栏扩到双栏，
    // 防 TS 常量漏改/回漂无红测——左轨漏改 = 工作区钳制宽度错 70px）。
    expect(MENUBAR_HEIGHT_PX).toBe(32)
    expect(RAIL_LEFT_WIDTH_PX).toBe(80)
    expect(RAIL_RIGHT_WIDTH_PX).toBe(296)
  })
})

describe('getWorkspaceBand（W4 Window Snap 工作区带，审计 .tmp/spaces-audit.md §7）', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true })
  })

  it('<640px 无左轨：left=0，宽高与 getWorkspaceViewport() 同数学', () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true })

    expect(getWorkspaceBand()).toEqual({
      left: 0,
      top: MENUBAR_HEIGHT_PX,
      width: 375,
      height: 700 - MENUBAR_HEIGHT_PX,
    })
  })

  it('≥640px 扣左轨（left=RAIL_LEFT_WIDTH_PX），≥1280px 再扣右栏', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    expect(getWorkspaceBand()).toEqual({
      left: RAIL_LEFT_WIDTH_PX,
      top: MENUBAR_HEIGHT_PX,
      width: 800 - RAIL_LEFT_WIDTH_PX,
      height: 800 - MENUBAR_HEIGHT_PX,
    })

    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    expect(getWorkspaceBand().width).toBe(1440 - RAIL_LEFT_WIDTH_PX - RAIL_RIGHT_WIDTH_PX)
    expect(getWorkspaceBand().left).toBe(RAIL_LEFT_WIDTH_PX)
  })

  it('band 高=带高到屏幕底（Dock z-40 浮于窗口 z-30 之上，审计 §7 snap 坐标系裁决）', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    expect(getWorkspaceBand().height).toBe(900 - MENUBAR_HEIGHT_PX)
  })
})
