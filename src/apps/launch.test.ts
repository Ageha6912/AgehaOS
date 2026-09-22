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
