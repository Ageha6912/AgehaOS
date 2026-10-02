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

  it('pins the window position when geometry is provided (系统调用钉位)', () => {
    launchApp('com.ageha.notes', { x: 912, y: 24 })

    const windows = useWindowStore.getState().windows
    expect(windows[0]?.x).toBe(912)
    expect(windows[0]?.y).toBe(24)
    // 尺寸仍来自 manifest。
    expect(windows[0]?.width).toBe(720)
  })

  it('keeps a no-geometry launch inside a narrow viewport (§25 位置兜底)', async () => {
    // 375px 视口：记事 720 → 尺寸钳 359；级联起点 x=80 曾把右缘推到 439。
    vi.stubGlobal('innerWidth', 375)
    vi.stubGlobal('innerHeight', 812)
    try {
      launchApp('com.ageha.notes')

      const win = useWindowStore.getState().windows[0]
      expect(win?.width).toBe(359)
      expect(win!.x).toBeGreaterThanOrEqual(8)
      expect(win!.x + win!.width).toBeLessThanOrEqual(375 - 8 + 0.5)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the cascade position untouched on wide viewports', () => {
    // jsdom 默认 innerWidth=1024：80 + 720 = 800 在视口内，级联起点不动。
    launchApp('com.ageha.notes')
    expect(useWindowStore.getState().windows[0]?.x).toBe(80)
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
