import { describe, it, expect, vi } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'
import { parseManifest } from './manifest'
import { AppRegistry } from './app-registry'

function validManifest(id = 'com.ageha.notes') {
  const result = parseManifest({
    id,
    name: 'Notes',
    version: '1.0.0',
    entry: '/apps/notes/index.html',
  })
  if (!result.ok) throw new Error('fixture manifest should parse')
  return result.manifest
}

function createRegistry() {
  const bus = new EventBus<SystemEventMap>()
  const installed = vi.fn()
  bus.on('app.installed', installed)
  return { registry: new AppRegistry(bus), installed }
}

describe('AppRegistry', () => {
  it('registers a manifest and emits app.installed', () => {
    const { registry, installed } = createRegistry()
    const manifest = validManifest()

    expect(registry.register(manifest)).toBe(true)
    expect(registry.get('com.ageha.notes')).toEqual(manifest)
    expect(registry.count).toBe(1)
    expect(installed).toHaveBeenCalledWith({ appId: 'com.ageha.notes' })
  })

  it('rejects a duplicate app id without emitting again', () => {
    const { registry, installed } = createRegistry()

    registry.register(validManifest())
    expect(registry.register(validManifest())).toBe(false)
    expect(registry.count).toBe(1)
    expect(installed).toHaveBeenCalledTimes(1)
  })

  it('unregisters apps and reports unknown ids', () => {
    const { registry } = createRegistry()
    registry.register(validManifest())

    expect(registry.unregister('com.ageha.notes')).toBe(true)
    expect(registry.unregister('com.ageha.notes')).toBe(false)
    expect(registry.get('com.ageha.notes')).toBeNull()
  })

  it('returns null for unknown apps and lists all manifests', () => {
    const { registry } = createRegistry()

    expect(registry.get('com.ageha.ghost')).toBeNull()

    registry.register(validManifest('com.ageha.notes'))
    registry.register(validManifest('com.ageha.files'))

    expect(registry.list().map((app) => app.id)).toEqual(['com.ageha.notes', 'com.ageha.files'])
  })

  it('returns a fresh list array on every call', () => {
    const { registry } = createRegistry()
    registry.register(validManifest())

    const list = registry.list()
    list.pop()

    expect(registry.count).toBe(1)
  })
})
