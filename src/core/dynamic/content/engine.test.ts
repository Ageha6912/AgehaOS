import { beforeEach, describe, expect, it } from 'vitest'

import { resetContextVersion } from '../context/snapshot'
import {
  assembleContentCards,
  greetingBodyKey,
  greetingTitleKey,
  suggestionsForPhase,
  tipBodyKey,
  validateContentCard,
} from './engine'
import type { ContentCard } from './engine'

const BUILTINS = [
  'com.ageha.notes',
  'com.ageha.files',
  'com.ageha.settings',
  'com.ageha.store',
  'com.ageha.calculator',
]

function input(overrides?: Partial<Parameters<typeof assembleContentCards>[0]>) {
  return {
    snapshot: { timePhase: 'day', season: 'autumn', theme: 'dark' } as const,
    dynamicEnabled: false,
    wallpaper: null,
    installedAppIds: BUILTINS,
    ...overrides,
  }
}

beforeEach(() => resetContextVersion())

describe('内容决策引擎（DDS §5.3，Phase B 本地切片）', () => {
  it('always opens with the phase greeting card', () => {
    const { cards, blocked } = assembleContentCards(input())
    expect(blocked).toBe(0)
    expect(cards[0]?.card).toEqual({ kind: 'greeting', phase: 'day' })
    expect(greetingTitleKey('day')).toBe('cards.greeting.day.title')
    expect(greetingBodyKey('night')).toBe('cards.greeting.night.body')
  })

  it('includes the wallpaper card only when the dynamic desktop is on', () => {
    const off = assembleContentCards(input())
    expect(off.cards.some((meta) => meta.card.kind === 'wallpaper')).toBe(false)

    const on = assembleContentCards(
      input({ dynamicEnabled: true, wallpaper: { style: 'particle-nebula', level: 'L0' } }),
    )
    const card = on.cards.find((meta) => meta.card.kind === 'wallpaper')?.card as ContentCard
    expect(card).toEqual({ kind: 'wallpaper', style: 'particle-nebula', level: 'L0' })
  })

  it('suggests phase-appropriate installed apps only (可行域过滤)', () => {
    const day = assembleContentCards(input())
    const dayCard = day.cards.find((meta) => meta.card.kind === 'suggest')?.card as ContentCard
    expect(dayCard.kind === 'suggest' && dayCard.appIds).toEqual([
      'com.ageha.files',
      'com.ageha.notes',
      'com.ageha.calculator',
    ])

    // 建议池中没有的应用不进入建议：白天池不含时钟，仅装时钟时无建议卡。
    const minimal = assembleContentCards(
      input({ snapshot: { timePhase: 'day', season: 'autumn', theme: 'dark' }, installedAppIds: ['com.ageha.samples.clock'] }),
    )
    const night = assembleContentCards(
      input({ snapshot: { timePhase: 'night', season: 'winter', theme: 'light' }, installedAppIds: ['com.ageha.samples.clock'] }),
    )
    const nightCard = night.cards.find((meta) => meta.card.kind === 'suggest')?.card as ContentCard
    expect(minimal.cards.some((meta) => meta.card.kind === 'suggest')).toBe(false)
    expect(nightCard.kind === 'suggest' && nightCard.appIds).toEqual(['com.ageha.samples.clock'])
  })

  it('rotates the tip deterministically per season', () => {
    const autumn = assembleContentCards(input())
    const winter = assembleContentCards(input({ snapshot: { timePhase: 'day', season: 'winter', theme: 'dark' } }))
    expect(tipBodyKey('shortcut')).toBe('cards.tip.shortcut')
    const autumnTip = autumn.cards.find((meta) => meta.card.kind === 'tip')?.card as ContentCard
    const winterTip = winter.cards.find((meta) => meta.card.kind === 'tip')?.card as ContentCard
    expect(autumnTip.kind === 'tip' && autumnTip.tipId).toBe('shortcut')
    expect(winterTip.kind === 'tip' && winterTip.tipId).toBe('privacy')
  })

  it('blocks schema-invalid cards at the local filter (§8.4)', () => {
    expect(validateContentCard({ kind: 'greeting', phase: 'day' })).toBeNull()
    expect(validateContentCard({ kind: 'unknown' } as unknown as ContentCard)).toBe('unknown-kind')
    expect(
      validateContentCard({ kind: 'wallpaper', style: 'x'.repeat(80), level: 'L0' } as ContentCard),
    ).toBe('invalid-style')
    expect(validateContentCard({ kind: 'suggest', appIds: [] } as ContentCard)).toBe('invalid-suggestions')
    expect(validateContentCard({ kind: 'tip', tipId: 'hax' } as ContentCard)).toBe('invalid-tip')
    // 引擎输出永不包含非法卡：blocked 计数为 0（内部构造全部合规）。
    const { cards, blocked } = assembleContentCards(input())
    for (const meta of cards) expect(validateContentCard(meta.card)).toBeNull()
    expect(blocked).toBe(0)
  })

  it('is deterministic for identical inputs (纯函数)', () => {
    const first = assembleContentCards(input({ dynamicEnabled: true, wallpaper: { style: 'fluid-gradient', level: 'F2' } }))
    const second = assembleContentCards(input({ dynamicEnabled: true, wallpaper: { style: 'fluid-gradient', level: 'F2' } }))
    expect(second).toEqual(first)
  })
})

describe('suggestionsForPhase', () => {
  it('keeps pool order and caps at three', () => {
    const all = suggestionsForPhase('morning', [
      ...BUILTINS,
      'com.ageha.samples.sticky',
      'com.ageha.samples.clock',
    ])
    expect(all).toEqual(['com.ageha.notes', 'com.ageha.samples.sticky', 'com.ageha.samples.clock'])
  })
})
