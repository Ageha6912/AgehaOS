import { describe, expect, it } from 'vitest'

import {
  buildLayoutSuggestion,
  LAYOUT_PROTECTED_APP_IDS,
  MAX_GROUP_MEMBERS,
  pruneLayoutSuggestion,
  validateLayoutSuggestion,
} from './engine'
import type { LayoutSuggestion } from './engine'

const BASE_SNAPSHOT = { timePhase: 'day' as const, contextVersion: 7 }

const CATALOG = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.settings',
  'com.ageha.calculator',
  'com.ageha.store',
  'com.ageha.dynamic.panel',
  'com.ageha.samples.clock',
  'com.ageha.samples.sticky',
  'com.ageha.samples.sketch',
]

describe('buildLayoutSuggestion', () => {
  it('is deterministic for the same input', () => {
    const input = { snapshot: BASE_SNAPSHOT, installedAppIds: CATALOG }
    expect(buildLayoutSuggestion(input)).toEqual(buildLayoutSuggestion(input))
  })

  it('never includes protected apps (DDS §5.2 iron rule 11)', () => {
    const suggestion = buildLayoutSuggestion({
      snapshot: BASE_SNAPSHOT,
      installedAppIds: CATALOG,
    })
    expect(suggestion).not.toBeNull()
    const members = suggestion?.groups.flatMap((group) => group.appIds) ?? []
    for (const protectedId of LAYOUT_PROTECTED_APP_IDS) {
      expect(members).not.toContain(protectedId)
    }
  })

  it('only suggests installed apps and drops empty groups', () => {
    const suggestion = buildLayoutSuggestion({
      snapshot: BASE_SNAPSHOT,
      installedAppIds: ['com.ageha.calculator', 'com.ageha.files', 'com.ageha.settings'],
    })
    // 唯一可行成员是 calculator → 单个 tools 组。
    expect(suggestion?.groups).toEqual([{ nameKey: 'tools', appIds: ['com.ageha.calculator'] }])
    expect(suggestion?.layoutId).toBe('layout-7')
  })

  it('returns null when the eligible domain is empty', () => {
    expect(
      buildLayoutSuggestion({
        snapshot: BASE_SNAPSHOT,
        installedAppIds: ['com.ageha.files', 'com.ageha.notes', 'com.ageha.settings'],
      }),
    ).toBeNull()
  })

  it('scales the tier with catalog size and phase', () => {
    const small = buildLayoutSuggestion({
      snapshot: { timePhase: 'night', contextVersion: 1 },
      installedAppIds: ['com.ageha.calculator'],
    })
    expect(small?.tier).toBe('single')

    const day = buildLayoutSuggestion({
      snapshot: { timePhase: 'day', contextVersion: 2 },
      installedAppIds: ['com.ageha.calculator', 'com.ageha.samples.clock'],
    })
    expect(day?.tier).toBe('double')

    const huge = buildLayoutSuggestion({
      snapshot: BASE_SNAPSHOT,
      installedAppIds: [
        ...Array.from({ length: 10 }, (_, index) => `com.example.app${index}`),
        'com.ageha.calculator',
      ],
    })
    expect(huge?.tier).toBe('grid')
  })

  it('caps group membership at MAX_GROUP_MEMBERS', () => {
    const suggestion = buildLayoutSuggestion({
      snapshot: BASE_SNAPSHOT,
      installedAppIds: Array.from({ length: 12 }, (_, index) => `com.example.tool${index}`),
    })
    for (const group of suggestion?.groups ?? []) {
      expect(group.appIds.length).toBeLessThanOrEqual(MAX_GROUP_MEMBERS)
    }
  })
})

describe('validateLayoutSuggestion', () => {
  const base: LayoutSuggestion = {
    layoutId: 'layout-1',
    tier: 'double',
    groups: [{ nameKey: 'tools', appIds: ['com.ageha.calculator'] }],
  }

  it('accepts a well-formed suggestion', () => {
    expect(validateLayoutSuggestion(base, ['com.ageha.calculator'])).toBeNull()
  })

  it.each([
    ['invalid-tier', { ...base, tier: 'mega' }],
    ['invalid-id', { ...base, layoutId: '' }],
    ['empty-groups', { ...base, groups: [] }],
    [
      'too-many-groups',
      {
        ...base,
        groups: [
          { nameKey: 'work', appIds: ['a1'] },
          { nameKey: 'create', appIds: ['a2'] },
          { nameKey: 'info', appIds: ['a3'] },
          { nameKey: 'tools', appIds: ['a4'] },
          { nameKey: 'tools', appIds: ['a5'] },
        ],
      },
    ],
    ['unknown-group-key', { ...base, groups: [{ nameKey: 'chaos', appIds: ['com.ageha.calculator'] }] }],
    ['empty-group', { ...base, groups: [{ nameKey: 'tools', appIds: [] }] }],
    ['protected-member', { ...base, groups: [{ nameKey: 'tools', appIds: ['com.ageha.settings'] }] }],
    ['uninstalled-member', { ...base, groups: [{ nameKey: 'tools', appIds: ['com.example.gone'] }] }],
    [
      'duplicate-member',
      {
        ...base,
        groups: [
          { nameKey: 'tools', appIds: ['com.ageha.calculator'] },
          { nameKey: 'info', appIds: ['com.ageha.calculator'] },
        ],
      },
    ],
  ])('rejects %s', (expected, suggestion) => {
    expect(
      validateLayoutSuggestion(suggestion as LayoutSuggestion, [
        'com.ageha.calculator',
        'a1',
        'a2',
        'a3',
        'a4',
        'a5',
      ]),
    ).toBe(expected)
  })
})

describe('pruneLayoutSuggestion', () => {
  it('drops uninstalled members and empty groups, keeps the rest', () => {
    const suggestion: LayoutSuggestion = {
      layoutId: 'layout-3',
      tier: 'double',
      groups: [
        { nameKey: 'tools', appIds: ['com.ageha.calculator', 'com.example.gone'] },
        { nameKey: 'create', appIds: ['com.example.also-gone'] },
      ],
    }
    const pruned = pruneLayoutSuggestion(suggestion, ['com.ageha.calculator'])
    expect(pruned).toEqual({
      layoutId: 'layout-3',
      tier: 'double',
      groups: [{ nameKey: 'tools', appIds: ['com.ageha.calculator'] }],
    })
  })

  it('returns null when nothing survives', () => {
    const suggestion: LayoutSuggestion = {
      layoutId: 'layout-4',
      tier: 'single',
      groups: [{ nameKey: 'tools', appIds: ['com.example.gone'] }],
    }
    expect(pruneLayoutSuggestion(suggestion, ['com.ageha.calculator'])).toBeNull()
  })

  it('refuses to resurrect protected apps', () => {
    const suggestion: LayoutSuggestion = {
      layoutId: 'layout-5',
      tier: 'single',
      groups: [{ nameKey: 'tools', appIds: ['com.ageha.settings'] }],
    }
    expect(pruneLayoutSuggestion(suggestion, ['com.ageha.settings'])).toBeNull()
  })
})
