import { afterEach, describe, expect, it } from 'vitest'

import { getWorkspaceViewport, MENUBAR_HEIGHT_PX } from './viewport'

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

    expect(getWorkspaceViewport()).toEqual({ width: 1000, height: 800 - MENUBAR_HEIGHT_PX })
  })

  it('keeps the TS constant in lockstep with the CSS token (--ag-menubar-height)', () => {
    // 与 src/index.css.test.ts 的 32px 值钉扎互为双保险——改任一侧都会红。
    expect(MENUBAR_HEIGHT_PX).toBe(32)
  })
})
