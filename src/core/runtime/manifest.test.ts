import { describe, it, expect } from 'vitest'

import { parseManifest } from './manifest'

const VALID_MANIFEST = {
  id: 'com.ageha.notes',
  name: 'Notes',
  version: '1.0.0',
  entry: '/apps/notes/index.html',
  icon: '/apps/notes/icon.png',
  permissions: ['storage', 'filesystem.read', 'notification'],
  window: { width: 900, height: 600, resizable: true },
  author: 'AgehaOS',
  description: 'Simple text editing',
}

describe('parseManifest', () => {
  it('accepts the PRD §9 example manifest and normalizes it', () => {
    const result = parseManifest(VALID_MANIFEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('com.ageha.notes')
    expect(result.manifest.permissions).toEqual(['storage', 'filesystem.read', 'notification'])
    expect(result.manifest.window).toEqual({ width: 900, height: 600, resizable: true })
    expect(result.manifest.author).toBe('AgehaOS')
  })

  it('rejects the bare "filesystem" permission from the PRD §9 sample in favor of §10.1 names', () => {
    const result = parseManifest({ ...VALID_MANIFEST, permissions: ['filesystem'] })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContainEqual({
      path: 'permissions[0]',
      message: 'Unknown permission "filesystem"',
    })
  })

  it('defaults permissions to an empty array', () => {
    const result = parseManifest({
      id: 'com.ageha.min',
      name: 'Min',
      version: '0.1.0',
      entry: '/apps/min/index.html',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.permissions).toEqual([])
  })

  it('rejects non-object input', () => {
    for (const input of [null, 'manifest', 42, []]) {
      const result = parseManifest(input)
      expect(result.ok).toBe(false)
    }
  })

  it('reports every missing required field at once', () => {
    const result = parseManifest({})

    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((issue) => issue.path)
    expect(paths).toEqual(expect.arrayContaining(['id', 'name', 'version', 'entry']))
    expect(result.errors).toHaveLength(4)
  })

  it('rejects a non reverse-domain app id', () => {
    const result = parseManifest({ ...VALID_MANIFEST, permissions: [], id: 'notes' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((issue) => issue.path === 'id')).toBe(true)
  })

  it('rejects a non semver version', () => {
    const result = parseManifest({
      ...VALID_MANIFEST,
      permissions: [],
      version: '1.0',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((issue) => issue.path === 'version')).toBe(true)
  })

  it('rejects a relative entry path', () => {
    const result = parseManifest({
      ...VALID_MANIFEST,
      permissions: [],
      entry: 'apps/notes/index.html',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((issue) => issue.path === 'entry')).toBe(true)
  })

  it('rejects unknown permissions with their index', () => {
    const result = parseManifest({
      ...VALID_MANIFEST,
      permissions: ['storage', 'root.access'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContainEqual({
      path: 'permissions[1]',
      message: 'Unknown permission "root.access"',
    })
  })

  it('dedupes repeated permissions', () => {
    const result = parseManifest({
      ...VALID_MANIFEST,
      permissions: ['storage', 'storage', 'network'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.permissions).toEqual(['storage', 'network'])
  })

  it('rejects unknown top-level fields', () => {
    const result = parseManifest({ ...VALID_MANIFEST, permission: ['storage'] })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContainEqual({
      path: 'permission',
      message: 'Unknown manifest field "permission"',
    })
  })

  it('validates the window block', () => {
    const result = parseManifest({
      ...VALID_MANIFEST,
      permissions: [],
      window: { width: -100, height: 1.5, resizable: 'yes', theme: 'dark' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((issue) => issue.path)
    expect(paths).toEqual(
      expect.arrayContaining(['window.width', 'window.height', 'window.resizable', 'window.theme']),
    )
  })

  it('accepts a prerelease version and empty permissions', () => {
    const result = parseManifest({
      id: 'com.ageha.beta',
      name: 'Beta',
      version: '0.2.0-beta.1',
      entry: '/apps/beta/index.html',
      permissions: [],
    })

    expect(result.ok).toBe(true)
  })

  it('freezes the parsed manifest against mutation', () => {
    const result = parseManifest(VALID_MANIFEST)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.isFrozen(result.manifest)).toBe(true)
    expect(Object.isFrozen(result.manifest.window)).toBe(true)
  })

  describe('mobile block (M0-3)', () => {
    const MOBILE_BLOCK = {
      supported: true,
      orientation: 'portrait',
      presentation: 'fullscreen',
    } as const

    it('accepts a legal mobile block and keeps every field', () => {
      const result = parseManifest({ ...VALID_MANIFEST, permissions: [], mobile: MOBILE_BLOCK })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.manifest.mobile).toEqual({
        supported: true,
        orientation: 'portrait',
        presentation: 'fullscreen',
      })
    })

    it('ignores the block entirely when the field is absent', () => {
      const result = parseManifest(VALID_MANIFEST)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.manifest.mobile).toBeUndefined()
    })

    it('freezes the parsed mobile block (deep freeze covers the new field)', () => {
      const result = parseManifest({ ...VALID_MANIFEST, permissions: [], mobile: MOBILE_BLOCK })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(Object.isFrozen(result.manifest.mobile)).toBe(true)
    })

    it('rejects an illegal orientation value', () => {
      const result = parseManifest({
        ...VALID_MANIFEST,
        permissions: [],
        mobile: { ...MOBILE_BLOCK, orientation: 'sideways' },
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors).toContainEqual({
        path: 'mobile.orientation',
        message: 'mobile.orientation must be one of "portrait", "landscape", "any"',
      })
    })

    it('rejects a non-fullscreen presentation value', () => {
      const result = parseManifest({
        ...VALID_MANIFEST,
        permissions: [],
        mobile: { ...MOBILE_BLOCK, presentation: 'windowed' },
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors).toContainEqual({
        path: 'mobile.presentation',
        message: 'mobile.presentation must be "fullscreen"',
      })
    })

    it('rejects a non-boolean supported flag', () => {
      const result = parseManifest({
        ...VALID_MANIFEST,
        permissions: [],
        mobile: { ...MOBILE_BLOCK, supported: 'yes' },
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors).toContainEqual({
        path: 'mobile.supported',
        message: 'mobile.supported must be a boolean',
      })
    })

    it('rejects a partial block — declared fields are not optional', () => {
      const result = parseManifest({
        ...VALID_MANIFEST,
        permissions: [],
        mobile: { supported: true },
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      const paths = result.errors.map((issue) => issue.path)
      expect(paths).toEqual(expect.arrayContaining(['mobile.orientation', 'mobile.presentation']))
    })

    it('rejects a non-object mobile block and unknown subfields with their path', () => {
      const nonObject = parseManifest({ ...VALID_MANIFEST, permissions: [], mobile: 'portrait' })
      expect(nonObject.ok).toBe(false)
      if (!nonObject.ok) {
        expect(nonObject.errors).toContainEqual({
          path: 'mobile',
          message: 'Field "mobile" must be an object',
        })
      }

      const unknownField = parseManifest({
        ...VALID_MANIFEST,
        permissions: [],
        mobile: { ...MOBILE_BLOCK, theme: 'dark' },
      })
      expect(unknownField.ok).toBe(false)
      if (!unknownField.ok) {
        expect(unknownField.errors).toContainEqual({
          path: 'mobile.theme',
          message: 'Unknown mobile field "theme"',
        })
      }
    })
  })
})
