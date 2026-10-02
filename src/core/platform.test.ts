import { describe, expect, it } from 'vitest'

import { altShortcutLabel, redoShortcutLabel, shortcutLabel } from './platform'

describe('shortcutLabel', () => {
  it('uses the command glyph on Apple platforms', () => {
    expect(shortcutLabel('K', true)).toBe('⌘K')
  })

  it('uses Ctrl+ elsewhere', () => {
    expect(shortcutLabel('K', false)).toBe('Ctrl+K')
  })

  it('defaults to the jsdom platform (non-Apple) without throwing', () => {
    expect(shortcutLabel('K')).toBe('Ctrl+K')
  })
})

describe('altShortcutLabel / redoShortcutLabel', () => {
  it('follows each platform convention', () => {
    expect(altShortcutLabel('W', true)).toBe('⌥W')
    expect(altShortcutLabel('W', false)).toBe('Alt+W')
    expect(redoShortcutLabel(true)).toBe('⇧⌘Z')
    expect(redoShortcutLabel(false)).toBe('Ctrl+Y')
  })
})
