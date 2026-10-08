import { beforeEach, describe, expect, it, vi } from 'vitest'

import { systemBus } from '@/core/events'
import { permissionManager } from '@/core/permissions'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { installApp, resetAppStore } from '@/store/app-store'

import { launchApp } from './launch'

beforeEach(() => {
  resetWindowStore()
  resetAppStore()
})

describe('launchApp', () => {
  it('returns null for uninstalled apps', () => {
    expect(launchApp('com.ageha.ghost')).toBeNull()
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it('opens a window with the manifest geometry and localized title', () => {
    const windowId = launchApp('com.ageha.notes')

    expect(windowId).not.toBeNull()
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe('com.ageha.notes')
    expect(windows[0]?.title).toBe('记事')
    expect(windows[0]?.width).toBe(720)
    expect(windows[0]?.height).toBe(480)
  })

  it('launches the eclosion trio with spec titles and spec geometry (§5.2)', () => {
    const windowId = launchApp('com.ageha.eclosion.calculator')

    expect(windowId).not.toBeNull()
    const win = useWindowStore.getState().windows[0]
    expect(win?.appId).toBe('com.ageha.eclosion.calculator')
    // 标题走规格 titleKey（非 manifest.name）；几何来自规格表（300 被
    // 窗口引擎 MIN_WINDOW_WIDTH=320 抬到下限——原生计算器同款行为）。
    expect(win?.title).toBe('计算器')
    expect(win?.width).toBe(320)
    expect(win?.height).toBe(440)

    const clockId = launchApp('com.ageha.eclosion.clock')
    expect(clockId).not.toBeNull()
    const clock = useWindowStore.getState().windows[1]
    expect(clock?.title).toBe('时钟')
    expect(clock?.width).toBe(420)
    expect(clock?.height).toBe(560)
  })

  it('pins the window position when geometry is provided (系统调用钉位)', () => {
    launchApp('com.ageha.notes', { x: 912, y: 24 })

    const windows = useWindowStore.getState().windows
    expect(windows[0]?.x).toBe(912)
    expect(windows[0]?.y).toBe(24)
    // 尺寸仍来自 manifest。
    expect(windows[0]?.width).toBe(720)
  })

  it('explicit width/height geometry overrides the workspace math (M1-6 移动全屏几何)', () => {
    // 移动 AppHost：device-store viewport 全宽高 + x=0 y=0——绕开桌面级联
    // 居中与工作区钳制（记事 manifest 720×480 被显式几何整体覆盖）。
    launchApp('com.ageha.notes', { x: 0, y: 0, width: 360, height: 800 }, 'user')

    const win = useWindowStore.getState().windows[0]
    expect(win?.x).toBe(0)
    expect(win?.y).toBe(0)
    expect(win?.width).toBe(360)
    expect(win?.height).toBe(800)
  })

  it('keeps a no-geometry launch inside a narrow viewport (§25 位置兜底)', async () => {
    // 375px 视口（<640 左组隐藏，railLeft=8）：记事 720 → 工作区内宽钳 343，
    // x=16，右缘 359 贴合视口（工作区口径）。
    vi.stubGlobal('innerWidth', 375)
    vi.stubGlobal('innerHeight', 812)
    try {
      launchApp('com.ageha.notes')

      const win = useWindowStore.getState().windows[0]
      expect(win?.width).toBe(343)
      expect(win!.x).toBe(16)
      expect(win!.x + win!.width).toBeLessThanOrEqual(375 - 8 + 0.5)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('clamps the y position into short viewports（§25 位置兜底纵轴）', async () => {
    // 1280×600：工作区纵带 40-504，记事 480 → y 钳到 40（底部 520）。
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 600)
    try {
      launchApp('com.ageha.notes')
      const win = useWindowStore.getState().windows[0]!
      expect(win.y).toBe(40)
      expect(win.y + win.height).toBeLessThanOrEqual(504 + 0.5)
      // jsdom 无样式表：Token 读 0 → railLeft 24/railRight 28 → x = 32+(1232-720)/2 = 278。
      expect(win.x).toBe(278)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('centers the window in the workspace on wide viewports（单栏拉长连带）', () => {
    // jsdom 1024（Token 缺省 railLeft 24/railRight 8）：工作区 992，记事
    // 720 居中 → x = 32+(976-720)/2 = 160。
    launchApp('com.ageha.notes')
    expect(useWindowStore.getState().windows[0]?.x).toBe(160)
  })

  it('refuses to launch when a requested permission is not granted', () => {
    permissionManager.revoke('com.ageha.notes', 'storage')
    const denied = vi.fn()
    systemBus.on('permission.denied', denied)

    expect(launchApp('com.ageha.notes')).toBeNull()
    expect(useWindowStore.getState().windows).toHaveLength(0)
    expect(denied).toHaveBeenCalledWith({
      appId: 'com.ageha.notes',
      permission: 'storage',
    })
    systemBus.off('permission.denied', denied)
  })

  it('launches once the missing permission is granted', () => {
    permissionManager.revoke('com.ageha.notes', 'storage')
    expect(launchApp('com.ageha.notes')).toBeNull()

    permissionManager.grant('com.ageha.notes', 'storage')

    expect(launchApp('com.ageha.notes')).not.toBeNull()
    expect(useWindowStore.getState().windows).toHaveLength(1)
  })

  it('falls back to the manifest name when no UI metadata exists', () => {
    resetAppStore()
    const result = installApp({
      id: 'com.ageha.plain',
      name: 'Plain App',
      version: '1.0.0',
      entry: '/apps/plain/index.html',
    })
    expect(result.ok).toBe(true)

    launchApp('com.ageha.plain')

    expect(useWindowStore.getState().windows[0]?.title).toBe('Plain App')
  })
})
